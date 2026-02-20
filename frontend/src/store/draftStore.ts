import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseInstagramExportJson } from "../utils/parseInstagramJson";
import { makeId, makeUuid } from "../utils/ids";

export type DraftFile = {
  id: string;
  name: string;
  messages_found: number;
  participants_found: number;
  errors_count: number;
  rejected_urls: string[];
  // raw mapping (normalized urls per sender name) used to rebuild
  sender_to_urls: Record<string, string[]>;
};

export type SenderOccurrence = {
  file_id: string;
  file_name: string;
  participant_name: string;
  reel_count: number;
};

export type DraftSender = {
  sender_id_local: string;
  display_name: string;
  occurrences: SenderOccurrence[];
  reel_urls: string[]; // dedup
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

export type DraftReelItem = { url: string; sender_ids: string[] };

type DraftState = {
  draft_version: "brp_draft_v1";
  local_room_id: string | null;

  join_code: string | null;
  master_key: string | null;

  parsing_busy: boolean;

  files: DraftFile[];
  senders: DraftSender[];
  reel_items: DraftReelItem[]; // derived from active senders
  stats: DraftStats;

  // actions
  createLocalRoom: () => void;
  setJoin: (join_code: string, master_key: string) => void;
  reset: () => void;

  importFiles: (fileList: FileList) => Promise<void>;
  removeFile: (file_id: string) => void;

  toggleSenderActive: (sender_id_local: string) => void;
  renameSender: (sender_id_local: string, name: string) => void;

  manualMerge: (sender_ids: string[], mergedName: string) => void;

  // auto-split toggle (by display_name): if called on an "auto" merged sender, split into per-file senders
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

function recompute(state: Pick<DraftState, "files" | "senders">) {
  const visible = state.senders.filter(s => !s.hidden);
  const active = visible.filter(s => s.active && s.reel_count_total > 0);

  // reel_items: url -> sender_ids (actifs only)
  const map = new Map<string, Set<string>>();
  for (const s of active) {
    for (const url of s.reel_urls) {
      if (!map.has(url)) map.set(url, new Set());
      map.get(url)!.add(s.sender_id_local);
    }
  }
  const reel_items: DraftReelItem[] = Array.from(map.entries()).map(([url, set]) => ({
    url,
    sender_ids: Array.from(set)
  }));

  const counts = active.map(s => s.reel_count_total).sort((a, b) => b - a);
  const rounds_max = counts.length >= 2 ? counts[1] : null;
  const rounds_complete = counts.length >= 2 ? Math.min(...counts) : null;

  const stats: DraftStats = {
    active_senders: active.length,
    reel_items: reel_items.length,
    rounds_max,
    rounds_complete,
    dedup_senders: visible.filter(s => s.badge !== "none").length,
    rejected_total: state.files.reduce((acc, f) => acc + (f.errors_count || 0), 0)
  };

  return { reel_items, stats };
}

function buildSendersFromFiles(files: DraftFile[]) {
  // auto merge strictly by sender name (display_name identical across files)
  const byName = new Map<string, DraftSender>();

  for (const f of files) {
    for (const [senderName, urls] of Object.entries(f.sender_to_urls)) {
      const key = senderName; // case-sensitive per spec
      const occ: SenderOccurrence = {
        file_id: f.id,
        file_name: f.name,
        participant_name: senderName,
        reel_count: urls.length
      };

      if (!byName.has(key)) {
        byName.set(key, {
          sender_id_local: `s_${makeUuid()}`,
          display_name: senderName,
          occurrences: [occ],
          reel_urls: [...urls],
          reel_count_total: urls.length,
          active: true,
          hidden: false,
          badge: "none"
        });
      } else {
        const s = byName.get(key)!;
        s.occurrences.push(occ);
        const set = new Set([...s.reel_urls, ...urls]);
        s.reel_urls = Array.from(set);
        s.reel_count_total = s.reel_urls.length;
        // if appears in >=2 files => auto merge badge
        if (s.occurrences.length >= 2) s.badge = "auto";
      }
    }
  }

  // sort senders by reel_count desc
  return Array.from(byName.values()).sort((a, b) => b.reel_count_total - a.reel_count_total);
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      draft_version: "brp_draft_v1",
      local_room_id: null,

      join_code: null,
      master_key: null,

      parsing_busy: false,

      files: [],
      senders: [],
      reel_items: [],
      stats: emptyStats(),

      createLocalRoom: () => {
        const st = get();
        if (st.local_room_id) return;
        const local_room_id = `local_${makeUuid()}`;
        set({ local_room_id });
      },

      setJoin: (join_code, master_key) => set({ join_code, master_key }),

      reset: () => {
        set({
          local_room_id: null,
          join_code: null,
          master_key: null,
          parsing_busy: false,
          files: [],
          senders: [],
          reel_items: [],
          stats: emptyStats()
        });
      },

      importFiles: async (fileList) => {
        const filesArr = Array.from(fileList || []);
        if (!filesArr.length) return;

        set({ parsing_busy: true });
        try {
          const prev = get().files.slice();

          for (const file of filesArr) {
            const text = await file.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { json = null; }
            if (!json) continue;

            const rep = parseInstagramExportJson(json);

            prev.push({
              id: `f_${makeUuid()}`,
              name: file.name,
              messages_found: rep.messages_found,
              participants_found: rep.participants_found,
              errors_count: rep.errors_count,
              rejected_urls: rep.rejected_urls,
              sender_to_urls: rep.sender_to_urls
            });
          }

          const senders = buildSendersFromFiles(prev);
          const { reel_items, stats } = recompute({ files: prev, senders });

          set({ files: prev, senders, reel_items, stats });
        } finally {
          set({ parsing_busy: false });
        }
      },

      removeFile: (file_id) => {
        const files = get().files.filter(f => f.id !== file_id);
        const senders = buildSendersFromFiles(files);
        const { reel_items, stats } = recompute({ files, senders });
        set({ files, senders, reel_items, stats });
      },

      toggleSenderActive: (sender_id_local) => {
        const senders = get().senders.map(s =>
          s.sender_id_local === sender_id_local ? { ...s, active: !s.active } : s
        );
        const { reel_items, stats } = recompute({ files: get().files, senders });
        set({ senders, reel_items, stats });
      },

      renameSender: (sender_id_local, name) => {
        const n = String(name || "").trim().slice(0, 48) || "Sender";
        const senders = get().senders.map(s =>
          s.sender_id_local === sender_id_local ? { ...s, display_name: n } : s
        );
        // rename doesn't change reel mapping; only stats dedup label, keep recompute for consistency
        const { reel_items, stats } = recompute({ files: get().files, senders });
        set({ senders, reel_items, stats });
      },

      manualMerge: (sender_ids, mergedName) => {
        const ids = Array.from(new Set(sender_ids || [])).filter(Boolean);
        if (ids.length < 2) return;

        const st = get();
        const selected = st.senders.filter(s => ids.includes(s.sender_id_local) && !s.hidden);
        if (selected.length < 2) return;

        const name = String(mergedName || selected[0].display_name).trim().slice(0, 48) || "Sender";

        const urls = new Set<string>();
        const occ: SenderOccurrence[] = [];
        for (const s of selected) {
          s.reel_urls.forEach(u => urls.add(u));
          occ.push(...(s.occurrences || []));
        }

        const merged: DraftSender = {
          sender_id_local: `s_${makeUuid()}`,
          display_name: name,
          occurrences: occ,
          reel_urls: Array.from(urls),
          reel_count_total: urls.size,
          active: true,
          hidden: false,
          badge: "manual"
        };

        const senders = st.senders.map(s => ids.includes(s.sender_id_local) ? { ...s, hidden: true, active: false } : s);
        senders.push(merged);

        const { reel_items, stats } = recompute({ files: st.files, senders });
        set({ senders, reel_items, stats });
      },

      toggleAutoSplitByName: (display_name) => {
        // split only the sender that is auto-merged with that display_name
        const st = get();
        const target = st.senders.find(s => !s.hidden && s.badge === "auto" && s.display_name === display_name);
        if (!target) return;

        // remove target (hide it) and create per-file senders
        const baseFiles = st.files;

        const splitSenders: DraftSender[] = [];
        for (const occ of target.occurrences) {
          const f = baseFiles.find(x => x.id === occ.file_id);
          if (!f) continue;
          const urls = f.sender_to_urls[occ.participant_name] || [];
          splitSenders.push({
            sender_id_local: `s_${makeUuid()}`,
            display_name: `${occ.participant_name} (${f.name})`,
            occurrences: [occ],
            reel_urls: Array.from(new Set(urls)),
            reel_count_total: Array.from(new Set(urls)).length,
            active: true,
            hidden: false,
            badge: "none"
          });
        }

        const senders = st.senders
          .map(s => (s.sender_id_local === target.sender_id_local ? { ...s, hidden: true, active: false } : s))
          .concat(splitSenders);

        const { reel_items, stats } = recompute({ files: st.files, senders });
        set({ senders, reel_items, stats });
      }
    }),
    { name: "brp_draft_v1" }
  )
);
