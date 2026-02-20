import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "../utils/ids";
import { parseInstagramExportJson } from "../utils/parseInstagramJson";

export type DraftFile = {
  id: string;
  name: string;
  messages_found: number;
  participants_found: number;
  errors_count: number;
  rejected_urls: string[];
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
  reel_urls: string[]; // unique normalized
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

export type Draft = {
  local_room_id: string | null;
  files: DraftFile[];
  senders: DraftSender[];
  reelItemsByUrl: Record<string, { url: string; sender_local_ids: string[] }>;
  stats: DraftStats;
  join_code?: string;
  master_key?: string;
};

type DraftState = Draft & {
  createLocalRoom: () => void;
  reset: () => void;
  importFiles: (files: File[]) => Promise<void>;
  removeFile: (fileId: string) => void;
  toggleSenderActive: (senderId: string) => void;
  renameSender: (senderId: string, name: string) => void;
  setJoin: (join_code: string, master_key: string) => void;
};

const EMPTY_STATS: DraftStats = {
  active_senders: 0,
  reel_items: 0,
  rounds_max: null,
  rounds_complete: null,
  dedup_senders: 0,
  rejected_total: 0
};

function computeStats(senders: DraftSender[], reelItemsByUrl: Draft["reelItemsByUrl"], files: DraftFile[]): DraftStats {
  const visible = senders.filter(s => !s.hidden);
  const active = visible.filter(s => s.active && s.reel_count_total > 0);
  const activeCounts = active.map(s => s.reel_count_total).sort((a,b)=>b-a);

  const rounds_max = activeCounts.length >= 2 ? activeCounts[1] : null;
  const rounds_complete = activeCounts.length >= 1 ? Math.min(...activeCounts) : null;

  const activeSenderIds = new Set(active.map(s => s.sender_id_local));
  let reel_items = 0;
  for (const it of Object.values(reelItemsByUrl)) {
    if (it.sender_local_ids.some(id => activeSenderIds.has(id))) reel_items += 1;
  }

  const rejected_total = files.reduce((sum, f) => sum + (f.errors_count || 0), 0);

  return {
    active_senders: active.length,
    reel_items,
    rounds_max,
    rounds_complete,
    dedup_senders: active.length,
    rejected_total
  };
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      local_room_id: null,
      files: [],
      senders: [],
      reelItemsByUrl: {},
      stats: EMPTY_STATS,

      createLocalRoom: () => {
        const id = uuid();
        set({ local_room_id: id, files: [], senders: [], reelItemsByUrl: {}, stats: EMPTY_STATS });
      },

      reset: () => {
        set({ local_room_id: null, files: [], senders: [], reelItemsByUrl: {}, stats: EMPTY_STATS, join_code: undefined, master_key: undefined });
      },

      setJoin: (join_code, master_key) => set({ join_code, master_key }),

      importFiles: async (files: File[]) => {
        // Parse all in-memory (MVP). Append.
        const current = get().files;
        const currentSenders = get().senders;
        const currentReelMap = { ...get().reelItemsByUrl };

        const newFileRows: DraftFile[] = [];
        const fileSenderUrls: Array<{ fileRow: DraftFile; sender_to_urls: Record<string,string[]> }> = [];

        for (const f of files) {
          const text = await f.text();
          let json: any = null;
          try { json = JSON.parse(text); } catch {
            const fileRow: DraftFile = { id: uuid(), name: f.name, messages_found: 0, participants_found: 0, errors_count: 1, rejected_urls: ["INVALID_JSON"] };
            newFileRows.push(fileRow);
            fileSenderUrls.push({ fileRow, sender_to_urls: {} });
            continue;
          }
          const rep = parseInstagramExportJson(json);
          const fileRow: DraftFile = {
            id: uuid(),
            name: f.name,
            messages_found: rep.messages_found,
            participants_found: rep.participants_found,
            errors_count: rep.errors_count,
            rejected_urls: rep.rejected_urls
          };
          newFileRows.push(fileRow);
          fileSenderUrls.push({ fileRow, sender_to_urls: rep.sender_to_urls });
        }

        // Build senders with auto-merge strict by name (cross files)
        const senderMap: Record<string, DraftSender> = {};
        const allFiles = [...current, ...newFileRows];

        // Rebuild from scratch from fileSenderUrls + existing ones is more correct, but MVP: merge in
        // For correctness, rebuild from scratch using current files data is needed (later).
        // Here: merge-in new files.
        for (const { fileRow, sender_to_urls } of fileSenderUrls) {
          for (const [senderName, urls] of Object.entries(sender_to_urls)) {
            if (!senderMap[senderName]) {
              // Try to reuse existing sender if exists
              const existing = currentSenders.find(s => s.display_name === senderName && !s.hidden);
              senderMap[senderName] = existing ? { ...existing } : {
                sender_id_local: uuid(),
                display_name: senderName,
                occurrences: [],
                reel_urls: [],
                reel_count_total: 0,
                active: true,
                hidden: false,
                badge: "none"
              };
            }
            const s = senderMap[senderName];
            s.occurrences = [...(s.occurrences || []), { file_id: fileRow.id, file_name: fileRow.name, participant_name: senderName, reel_count: urls.length }];
            const setUrls = new Set([...(s.reel_urls || []), ...urls]);
            s.reel_urls = Array.from(setUrls);
            s.reel_count_total = s.reel_urls.length;
            // Badge auto if appears in multiple files
            const fileSet = new Set(s.occurrences.map(o => o.file_id));
            s.badge = fileSet.size >= 2 ? "auto" : s.badge;
          }
        }

        // Merge senderMap with existing senders that weren't touched
        const mergedSenders: DraftSender[] = [
          ...currentSenders.filter(s => !Object.keys(senderMap).includes(s.display_name)),
          ...Object.values(senderMap)
        ];

        // Rebuild reelItemsByUrl with new urls (MVP merge)
        for (const s of Object.values(senderMap)) {
          for (const url of s.reel_urls) {
            if (!currentReelMap[url]) currentReelMap[url] = { url, sender_local_ids: [] };
            if (!currentReelMap[url].sender_local_ids.includes(s.sender_id_local)) {
              currentReelMap[url].sender_local_ids.push(s.sender_id_local);
            }
          }
        }

        const stats = computeStats(mergedSenders, currentReelMap, allFiles);
        set({ files: allFiles, senders: mergedSenders, reelItemsByUrl: currentReelMap, stats });
      },

      removeFile: (fileId: string) => {
        // MVP: remove file row only. Full rebuild should be implemented.
        const files = get().files.filter(f => f.id !== fileId);
        set({ files });
        set({ stats: computeStats(get().senders, get().reelItemsByUrl, files) });
      },

      toggleSenderActive: (senderId: string) => {
        const senders = get().senders.map(s => s.sender_id_local === senderId ? { ...s, active: !s.active } : s);
        const stats = computeStats(senders, get().reelItemsByUrl, get().files);
        set({ senders, stats });
      },

      renameSender: (senderId: string, name: string) => {
        const senders = get().senders.map(s => s.sender_id_local === senderId ? { ...s, display_name: name } : s);
        set({ senders });
      }
    }),
    { name: "brp_draft_v1" }
  )
);
