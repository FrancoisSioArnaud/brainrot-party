// frontend/src/store/draftStore.ts
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

const LS_KEY = "brp_draft_v1";

export type DraftFile = {
  id: string;
  name: string;
  messages_found: number;
  participants_found: number;
  rejected_urls: string[];
  errors_count: number;
};

export type DraftSenderOccurrence = {
  file_id: string;
  file_name: string;
  participant_name: string;
  reel_count: number;

  // ✅ NEW: indispensable pour “Défusionner” correctement par fichier
  // (sinon impossible de split les URLs selon la provenance)
  reel_urls: string[];
};

export type DraftSender = {
  sender_id_local: string;
  display_name: string;
  occurrences: DraftSenderOccurrence[];
  reel_urls_set: string[]; // urls uniques globales du sender
  reel_count_total: number;
  active: boolean;
  hidden: boolean;
  badge: "none" | "auto" | "manual";
};

export type DraftStats = {
  active_senders: number;
  reel_items: number;
  rounds_max: number | null;
  rounds_complete: number | null;
  dedup_senders: number;
  rejected_total: number;
};

export type ReelItemByUrl = Record<string, { url: string; sender_local_ids: string[] }>;

type DraftState = {
  draft_version: "brp_draft_v1";

  local_room_id: string | null;

  join_code: string | null;
  master_key: string | null;

  parsing_busy: boolean;

  files: DraftFile[];
  senders: DraftSender[];
  reelItemsByUrl: ReelItemByUrl;
  stats: DraftStats;

  createLocalRoom: () => void;
  setJoin: (join_code: string, master_key: string) => void;
  reset: () => void;

  importFiles: (files: File[]) => Promise<void>;
  removeFile: (file_id: string) => Promise<void>;

  renameSender: (sender_id_local: string, name: string) => void;
  toggleSenderActive: (sender_id_local: string) => void;

  manualMerge: (sender_ids: string[], mergedName: string) => void;
  toggleAutoSplitByName: (display_name: string) => void;
};

function emptyStats(): DraftStats {
  return {
    active_senders: 0,
    reel_items: 0,
    rounds_max: null,
    rounds_complete: null,
    dedup_senders: 0,
    rejected_total: 0
  };
}

function saveLS(state: Partial<DraftState>) {
  try {
    const cur = loadLS();
    const next = { ...(cur || {}), ...(state as any), draft_version: "brp_draft_v1" };
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {}
}

function loadLS(): Partial<DraftState> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o?.draft_version !== "brp_draft_v1") return null;
    return o;
  } catch {
    return null;
  }
}

function normalizeInstagramUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.protocol = "https:";
    u.hash = "";
    u.search = "";

    // keep only instagram.com/{reel|p|tv}/{shortcode}/
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "instagram.com") return null;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const kind = parts[0];
    const shortcode = parts[1];
    if (!["reel", "p", "tv"].includes(kind)) return null;
    if (!shortcode) return null;

    return `https://www.instagram.com/${kind}/${shortcode}/`;
  } catch {
    return null;
  }
}

function participantsFromJson(obj: any): string[] {
  const names = new Set<string>();
  const msgs = Array.isArray(obj?.messages) ? obj.messages : [];
  for (const m of msgs) {
    const n =
      (typeof m?.sender_name === "string" && m.sender_name) ||
      (typeof m?.sender === "string" && m.sender) ||
      (typeof m?.from === "string" && m.from) ||
      null;
    if (n) names.add(n);
  }
  return Array.from(names);
}

function senderNameForMessage(m: any): string | null {
  const n =
    (typeof m?.sender_name === "string" && m.sender_name) ||
    (typeof m?.sender === "string" && m.sender) ||
    (typeof m?.from === "string" && m.from) ||
    null;
  return n ? String(n) : null;
}

type SourceFile = { id: string; name: string; json: any };

function recomputeFromFiles(filesRaw: SourceFile[]) {
  // Build per-file report + sender map (strict name across files => auto-fusion)
  const files: DraftFile[] = [];

  const senderMap = new Map<
    string,
    {
      occurrences: DraftSenderOccurrence[];
      urls: Set<string>; // global union
    }
  >();

  for (const f of filesRaw) {
    const msgs = Array.isArray(f.json?.messages) ? f.json.messages : [];
    const rejected_urls: string[] = [];
    const urlsBySender = new Map<string, Set<string>>();

    for (const m of msgs) {
      const raw = m?.share?.link;
      if (typeof raw !== "string") continue;

      const norm = normalizeInstagramUrl(raw);
      const sname = senderNameForMessage(m);

      if (!norm || !sname) {
        rejected_urls.push(String(raw));
        continue;
      }

      const set = urlsBySender.get(sname) || new Set<string>();
      set.add(norm);
      urlsBySender.set(sname, set);
    }

    const participants = new Set<string>(participantsFromJson(f.json));
    for (const k of urlsBySender.keys()) participants.add(k);

    files.push({
      id: f.id,
      name: f.name,
      messages_found: msgs.length,
      participants_found: participants.size,
      rejected_urls,
      errors_count: rejected_urls.length
    });

    for (const [name, urlSet] of urlsBySender.entries()) {
      const cur = senderMap.get(name) || { occurrences: [], urls: new Set<string>() };

      const reel_urls = Array.from(urlSet);
      cur.occurrences.push({
        file_id: f.id,
        file_name: f.name,
        participant_name: name,
        reel_count: reel_urls.length,
        reel_urls // ✅ NEW
      });

      for (const u of urlSet) cur.urls.add(u);
      senderMap.set(name, cur);
    }
  }

  const senders: DraftSender[] = [];
  for (const [display_name, v] of senderMap.entries()) {
    const reel_urls_set = Array.from(v.urls);
    const reel_count_total = reel_urls_set.length;

    senders.push({
      sender_id_local: `s_${uuidv4()}`,
      display_name,
      occurrences: v.occurrences,
      reel_urls_set,
      reel_count_total,
      active: reel_count_total > 0,
      hidden: false,
      badge: v.occurrences.length >= 2 ? "auto" : "none"
    });
  }

  // Build reelItemsByUrl
  const reelItemsByUrl: ReelItemByUrl = {};
  for (const s of senders.filter((x) => !x.hidden)) {
    for (const url of s.reel_urls_set) {
      if (!reelItemsByUrl[url]) reelItemsByUrl[url] = { url, sender_local_ids: [] };
      reelItemsByUrl[url].sender_local_ids.push(s.sender_id_local);
    }
  }

  const stats = computeStats(senders, reelItemsByUrl, files);

  return { files, senders, reelItemsByUrl, stats };
}

function computeStats(senders: DraftSender[], reelItemsByUrl: ReelItemByUrl, files: DraftFile[]): DraftStats {
  const active = senders.filter((s) => !s.hidden && s.active && s.reel_count_total > 0);
  const reel_items = Object.keys(reelItemsByUrl).length;

  const active_senders = active.length;
  const dedup_senders = senders.filter((s) => !s.hidden).length;

  const rejected_total = files.reduce((acc, f) => acc + (f.errors_count || 0), 0);

  // rounds_max/complete are computed elsewhere in UI (keep null here)
  return {
    active_senders,
    reel_items,
    rounds_max: null,
    rounds_complete: null,
    dedup_senders,
    rejected_total
  };
}

async function readFileAsJson(file: File): Promise<any> {
  const txt = await file.text();
  return JSON.parse(txt);
}

function asLobbyReelItems(senders: DraftSender[], reelItemsByUrl: ReelItemByUrl) {
  // backend expects [{ url, sender_local_ids }]
  // keep only urls belonging to non-hidden senders
  const visibleSenderIds = new Set(senders.filter((s) => !s.hidden).map((s) => s.sender_id_local));

  const out: Array<{ url: string; sender_local_ids: string[] }> = [];
  for (const [url, v] of Object.entries(reelItemsByUrl)) {
    const ids = v.sender_local_ids.filter((id) => visibleSenderIds.has(id));
    if (ids.length) out.push({ url, sender_local_ids: ids });
  }
  return out;
}

export const useDraftStore = create<DraftState>((set, get) => {
  const ls = loadLS();

  return {
    draft_version: "brp_draft_v1",

    local_room_id: (ls?.local_room_id as any) ?? null,

    join_code: (ls?.join_code as any) ?? null,
    master_key: (ls?.master_key as any) ?? null,

    parsing_busy: false,

    files: (ls?.files as any) ?? [],
    senders: (ls?.senders as any) ?? [],
    reelItemsByUrl: (ls?.reelItemsByUrl as any) ?? {},
    stats: (ls?.stats as any) ?? emptyStats(),

    createLocalRoom: () => {
      const id = `lr_${uuidv4()}`;
      set({ local_room_id: id });
      saveLS({ local_room_id: id });
    },

    setJoin: (join_code, master_key) => {
      set({ join_code, master_key });
      saveLS({ join_code, master_key });
    },

    reset: () => {
      set({
        local_room_id: null,
        join_code: null,
        master_key: null,
        parsing_busy: false,
        files: [],
        senders: [],
        reelItemsByUrl: {},
        stats: emptyStats()
      });
      try {
        localStorage.removeItem(LS_KEY);
      } catch {}
    },

    importFiles: async (filesInput) => {
      set({ parsing_busy: true });

      try {
        const sources: SourceFile[] = [];
        for (const f of filesInput) {
          const json = await readFileAsJson(f);
          sources.push({ id: `f_${uuidv4()}`, name: f.name, json });
        }

        const { files, senders, reelItemsByUrl, stats } = recomputeFromFiles(sources);

        set({ files, senders, reelItemsByUrl, stats, parsing_busy: false });
        saveLS({ files, senders, reelItemsByUrl, stats });
      } catch {
        set({ parsing_busy: false });
        throw new Error("Import failed");
      }
    },

    removeFile: async (_file_id) => {
      // (impl exists in original file; keep as-is in your repo)
      // This full file is provided to paste over; if you already have a removeFile implementation,
      // keep it and only ensure buildLobbyDraftPayload + typings are identical.
      throw new Error("removeFile not implemented in this snippet; keep your repo's existing implementation.");
    },

    renameSender: (_sender_id_local, _name) => {
      throw new Error("renameSender not implemented in this snippet; keep your repo's existing implementation.");
    },

    toggleSenderActive: (_sender_id_local) => {
      throw new Error("toggleSenderActive not implemented in this snippet; keep your repo's existing implementation.");
    },

    manualMerge: (_sender_ids, _mergedName) => {
      throw new Error("manualMerge not implemented in this snippet; keep your repo's existing implementation.");
    },

    toggleAutoSplitByName: (_display_name) => {
      throw new Error("toggleAutoSplitByName not implemented in this snippet; keep your repo's existing implementation.");
    }
  };
});

// IMPORTANT: keep your existing implementations above.
// Only this function is required for the TS2345 fix (local_room_id must be string).
export function buildLobbyDraftPayload() {
  const st = useDraftStore.getState();

  const senders_active = st.senders
    .filter((s) => !s.hidden && s.active && s.reel_count_total > 0)
    .map((s) => ({ id_local: s.sender_id_local, name: s.display_name, active: true }));

  const players_auto = senders_active.map((s) => ({
    id: `auto_${s.id_local}`,
    type: "sender_linked" as const,
    sender_id: s.id_local,
    active: true,
    name: s.name
  }));

  const reel_items = asLobbyReelItems(st.senders, st.reelItemsByUrl);

  if (!st.local_room_id) {
    throw new Error("local_room_id is required");
  }

  return {
    local_room_id: st.local_room_id,
    senders_active,
    players: players_auto,
    reel_items
  };
}
