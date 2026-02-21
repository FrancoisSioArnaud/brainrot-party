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
};

export type DraftSender = {
  sender_id_local: string;
  display_name: string;
  occurrences: DraftSenderOccurrence[];
  reel_urls_set: string[];
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

export type ReelItemByUrl = Record<
  string,
  { url: string; sender_local_ids: string[] }
>;

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

function extractLinksFromJson(obj: any): string[] {
  const out: string[] = [];
  const msgs = Array.isArray(obj?.messages) ? obj.messages : [];
  for (const m of msgs) {
    const link = m?.share?.link;
    if (typeof link === "string") out.push(link);
  }
  return out;
}

function participantsFromJson(obj: any): string[] {
  // Spec: sender = participant instagram name found by parsing messages
  // Here: we infer from messages[].sender_name OR messages[].sender OR messages[].from
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

function recomputeFromFiles(filesRaw: Array<{ id: string; name: string; json: any }>) {
  // Build per-file report + sender map (strict name across files => auto-fusion)
  const files: DraftFile[] = [];
  const senderMap = new Map<string, { occurrences: DraftSenderOccurrence[]; urls: Set<string> }>();
  const rejectedByFile = new Map<string, string[]>();

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
    // also include any sender found in share messages
    for (const k of urlsBySender.keys()) participants.add(k);

    files.push({
      id: f.id,
      name: f.name,
      messages_found: msgs.length,
      participants_found: participants.size,
      rejected_urls,
      errors_count: rejected_urls.length
    });

    rejectedByFile.set(f.id, rejected_urls);

    for (const [name, urlSet] of urlsBySender.entries()) {
      const cur = senderMap.get(name) || { occurrences: [], urls: new Set<string>() };
      cur.occurrences.push({
        file_id: f.id,
        file_name: f.name,
        participant_name: name,
        reel_count: urlSet.size
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

  // reelItemsByUrl: url -> sender_local_ids[]
  const reelItemsByUrl: ReelItemByUrl = {};
  for (const s of senders) {
    for (const url of s.reel_urls_set) {
      if (!reelItemsByUrl[url]) reelItemsByUrl[url] = { url, sender_local_ids: [] };
      reelItemsByUrl[url].sender_local_ids.push(s.sender_id_local);
    }
  }

  const stats = computeStats(senders, reelItemsByUrl, files);

  return { files, senders, reelItemsByUrl, stats };
}

function computeStats(senders: DraftSender[], reelItemsByUrl: ReelItemByUrl, files: DraftFile[]): DraftStats {
  const active = senders.filter(s => !s.hidden && s.active && s.reel_count_total > 0);
  const activeCount = active.length;

  // reelItems uniques sur base des senders actifs
  const activeSet = new Set(active.map(s => s.sender_id_local));
  let reelItems = 0;
  for (const url of Object.keys(reelItemsByUrl)) {
    const ids = reelItemsByUrl[url].sender_local_ids;
    if (ids.some(id => activeSet.has(id))) reelItems++;
  }

  const sortedCounts = active.map(s => s.reel_count_total).slice().sort((a, b) => b - a);
  const rounds_max = sortedCounts.length >= 2 ? sortedCounts[1] : null;
  const rounds_complete = sortedCounts.length >= 2 ? Math.min(...sortedCounts) : null;

  const rejected_total = files.reduce((sum, f) => sum + (f.rejected_urls?.length || 0), 0);

  const dedup_senders = senders.filter(s => !s.hidden).length;

  return {
    active_senders: activeCount,
    reel_items: reelItems,
    rounds_max,
    rounds_complete,
    dedup_senders,
    rejected_total
  };
}

function asLobbyReelItems(senders: DraftSender[], reelItemsByUrl: ReelItemByUrl) {
  const activeSenders = senders.filter(s => !s.hidden && s.active && s.reel_count_total > 0);
  const activeSet = new Set(activeSenders.map(s => s.sender_id_local));

  const out: Array<{ url: string; sender_local_ids: string[] }> = [];
  for (const url of Object.keys(reelItemsByUrl)) {
    const ids = reelItemsByUrl[url].sender_local_ids.filter(id => activeSet.has(id));
    if (ids.length === 0) continue;
    out.push({ url, sender_local_ids: ids });
  }
  return out;
}

const initialLS = loadLS();

export const useDraftStore = create<DraftState>((set, get) => ({
  draft_version: "brp_draft_v1",

  local_room_id: (initialLS?.local_room_id as any) ?? null,

  join_code: (initialLS?.join_code as any) ?? null,
  master_key: (initialLS?.master_key as any) ?? null,

  parsing_busy: false,

  files: (initialLS?.files as any) ?? [],
  senders: (initialLS?.senders as any) ?? [],
  reelItemsByUrl: (initialLS?.reelItemsByUrl as any) ?? {},
  stats: (initialLS?.stats as any) ?? emptyStats(),

  createLocalRoom: () => {
    const id = uuidv4();
    set({
      local_room_id: id,
      join_code: null,
      master_key: null,
      files: [],
      senders: [],
      reelItemsByUrl: {},
      stats: emptyStats()
    });
    saveLS({
      local_room_id: id,
      join_code: null,
      master_key: null,
      files: [],
      senders: [],
      reelItemsByUrl: {},
      stats: emptyStats()
    });
  },

  setJoin: (join_code, master_key) => {
    set({ join_code, master_key });
    saveLS({ join_code, master_key });
  },

  reset: () => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
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
  },

  importFiles: async (addedFiles: File[]) => {
    if (!addedFiles || addedFiles.length === 0) return;

    set({ parsing_busy: true });

    try {
      // load existing source jsons from LS
      const curAny = loadLS() || {};
      const sources: Array<{ id: string; name: string; json: any }> = Array.isArray((curAny as any)._sources)
        ? (curAny as any)._sources
        : [];

      for (const f of addedFiles) {
        const text = await f.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = { messages: [] };
        }
        sources.push({ id: `f_${uuidv4()}`, name: f.name || "file.json", json });
      }

      const rebuilt = recomputeFromFiles(sources);

      set({
        files: rebuilt.files,
        senders: rebuilt.senders,
        reelItemsByUrl: rebuilt.reelItemsByUrl,
        stats: rebuilt.stats
      });

      // persist (include private _sources for rebuild on remove)
      saveLS({
        files: rebuilt.files,
        senders: rebuilt.senders,
        reelItemsByUrl: rebuilt.reelItemsByUrl,
        stats: rebuilt.stats,
        _sources: sources as any
      } as any);
    } finally {
      set({ parsing_busy: false });
    }
  },

  removeFile: async (file_id: string) => {
    set({ parsing_busy: true });
    try {
      const curAny = loadLS() || {};
      const sources: Array<{ id: string; name: string; json: any }> = Array.isArray((curAny as any)._sources)
        ? (curAny as any)._sources
        : [];

      const nextSources = sources.filter(s => s.id !== file_id);

      const rebuilt = recomputeFromFiles(nextSources);

      set({
        files: rebuilt.files,
        senders: rebuilt.senders,
        reelItemsByUrl: rebuilt.reelItemsByUrl,
        stats: rebuilt.stats
      });

      saveLS({
        files: rebuilt.files,
        senders: rebuilt.senders,
        reelItemsByUrl: rebuilt.reelItemsByUrl,
        stats: rebuilt.stats,
        _sources: nextSources as any
      } as any);
    } finally {
      set({ parsing_busy: false });
    }
  },

  renameSender: (sender_id_local: string, name: string) => {
    const senders = get().senders.map(s =>
      s.sender_id_local === sender_id_local ? { ...s, display_name: name } : s
    );

    const stats = computeStats(senders, get().reelItemsByUrl, get().files);

    set({ senders, stats });
    saveLS({ senders, stats });
  },

  toggleSenderActive: (sender_id_local: string) => {
    const senders = get().senders.map(s => {
      if (s.sender_id_local !== sender_id_local) return s;
      if (s.reel_count_total === 0) return s; // non cliquable si 0 reel
      return { ...s, active: !s.active };
    });

    const stats = computeStats(senders, get().reelItemsByUrl, get().files);

    set({ senders, stats });
    saveLS({ senders, stats });
  },

  manualMerge: (sender_ids: string[], mergedName: string) => {
    const setIds = new Set(sender_ids);
    const cur = get().senders;

    const selected = cur.filter(s => setIds.has(s.sender_id_local) && !s.hidden);
    if (selected.length < 2) return;

    const urls = new Set<string>();
    const occ: DraftSenderOccurrence[] = [];
    for (const s of selected) {
      for (const u of s.reel_urls_set) urls.add(u);
      for (const o of (s.occurrences || [])) occ.push(o);
    }

    const newSender: DraftSender = {
      sender_id_local: `s_${uuidv4()}`,
      display_name: (mergedName || selected[0].display_name || "Sender").slice(0, 64),
      occurrences: occ,
      reel_urls_set: Array.from(urls),
      reel_count_total: urls.size,
      active: urls.size > 0,
      hidden: false,
      badge: "manual"
    };

    const senders = cur.map(s => (setIds.has(s.sender_id_local) ? { ...s, hidden: true } : s));
    senders.push(newSender);

    // rebuild reelItemsByUrl from visible senders (including hidden? spec says hidden excluded)
    const reelItemsByUrl: ReelItemByUrl = {};
    for (const s of senders.filter(x => !x.hidden)) {
      for (const url of s.reel_urls_set) {
        if (!reelItemsByUrl[url]) reelItemsByUrl[url] = { url, sender_local_ids: [] };
        reelItemsByUrl[url].sender_local_ids.push(s.sender_id_local);
      }
    }

    const stats = computeStats(senders, reelItemsByUrl, get().files);

    set({ senders, reelItemsByUrl, stats });
    saveLS({ senders, reelItemsByUrl, stats });
  },

  toggleAutoSplitByName: (display_name: string) => {
    // Minimal MVP:
    // - If there is an AUTO sender with this display_name, split it into one sender per occurrence (file).
    // - If there are already split senders like "Name (file.json)" we don't auto-remerge here.
    const cur = get().senders;

    const target = cur.find(s => !s.hidden && s.badge === "auto" && s.display_name === display_name);
    if (!target) return;

    const splits: DraftSender[] = [];
    for (const o of target.occurrences || []) {
      const id = `s_${uuidv4()}`;
      // Keep only URLs that belonged to that file occurrence (we can’t perfectly know without per-file url map,
      // so MVP: keep all urls; real split-by-file requires storing urls per file.)
      splits.push({
        sender_id_local: id,
        display_name: `${display_name} (${o.file_name})`,
        occurrences: [o],
        reel_urls_set: [...target.reel_urls_set],
        reel_count_total: target.reel_count_total,
        active: target.reel_count_total > 0,
        hidden: false,
        badge: "none"
      });
    }

    const senders = cur
      .map(s => (s.sender_id_local === target.sender_id_local ? { ...s, hidden: true } : s))
      .concat(splits);

    // rebuild reelItemsByUrl from visible senders
    const reelItemsByUrl: ReelItemByUrl = {};
    for (const s of senders.filter(x => !x.hidden)) {
      for (const url of s.reel_urls_set) {
        if (!reelItemsByUrl[url]) reelItemsByUrl[url] = { url, sender_local_ids: [] };
        reelItemsByUrl[url].sender_local_ids.push(s.sender_id_local);
      }
    }

    const stats = computeStats(senders, reelItemsByUrl, get().files);

    set({ senders, reelItemsByUrl, stats });
    saveLS({ senders, reelItemsByUrl, stats });
  }
}));

// Helper export used by Lobby.tsx without duplicating logic
export function buildLobbyDraftPayload() {
  const st = useDraftStore.getState();

  const senders_active = st.senders
    .filter(s => !s.hidden && s.active && s.reel_count_total > 0)
    .map(s => ({ id_local: s.sender_id_local, name: s.display_name, active: true }));

  const players_auto = senders_active.map(s => ({
    id: `auto_${s.id_local}`,
    type: "sender_linked" as const,
    sender_id: s.id_local,
    active: true,
    name: s.name
  }));

  const reel_items = asLobbyReelItems(st.senders, st.reelItemsByUrl);

  return {
    local_room_id: st.local_room_id,
    senders_active,
    players: players_auto,
    reel_items
  };
}
