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

  // Nécessaire pour rebuild total au remove
  // sender name => normalized urls (dedup within sender)
  sender_to_urls: Record<string, string[]>;
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
  rounds_complete: number | null; // null => afficher "—"
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
  parsing_busy: boolean;
  createLocalRoom: () => void;
  reset: () => void;
  importFiles: (files: File[]) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
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

function computeStats(
  senders: DraftSender[],
  reelItemsByUrl: Draft["reelItemsByUrl"],
  files: DraftFile[]
): DraftStats {
  // Hidden senders exclus des stats (spec)
  const visible = senders.filter(s => !s.hidden);

  // Actifs = visible + active=true + reel_count>0
  const active = visible.filter(s => s.active && s.reel_count_total > 0);
  const activeCounts = active.map(s => s.reel_count_total).sort((a, b) => b - a);

  // Spec:
  // rounds_max = reels du 2e sender le plus fourni => null si <2
  const rounds_max = activeCounts.length >= 2 ? activeCounts[1] : null;

  // Spec:
  // rounds_complets = reels du sender le moins fourni MAIS afficher "—" si <2 actifs
  const rounds_complete = activeCounts.length >= 2 ? Math.min(...activeCounts) : null;

  // ReelItems uniques sur base des senders actifs
  const activeSenderIds = new Set(active.map(s => s.sender_id_local));
  let reel_items = 0;
  for (const it of Object.values(reelItemsByUrl)) {
    if (it.sender_local_ids.some(id => activeSenderIds.has(id))) reel_items += 1;
  }

  const rejected_total = files.reduce((sum, f) => sum + (f.errors_count || 0), 0);

  // "Senders dédoublonnés (après fusion manuelle draft)"
  // Tant que la fusion manuelle n’est pas implémentée, on compte simplement les senders visibles.
  const dedup_senders = visible.length;

  return {
    active_senders: active.length,
    reel_items,
    rounds_max,
    rounds_complete,
    dedup_senders,
    rejected_total
  };
}

/**
 * Rebuild total depuis la source de vérité: files[].sender_to_urls
 * - auto-merge strict par display_name (case-sensitive)
 * - conserve au mieux sender_id_local + active si sender existait déjà
 */
function rebuildFromFiles(files: DraftFile[], prevSenders: DraftSender[]) {
  const prevByName = new Map<string, DraftSender>();
  for (const s of prevSenders) {
    if (!s.hidden) prevByName.set(s.display_name, s);
  }

  const senderMap = new Map<string, DraftSender>();
  const reelItemsByUrl: Draft["reelItemsByUrl"] = {};

  for (const f of files) {
    for (const [senderName, urls] of Object.entries(f.sender_to_urls || {})) {
      let s = senderMap.get(senderName);
      if (!s) {
        const prev = prevByName.get(senderName);
        s = prev
          ? {
              ...prev,
              occurrences: [],
              reel_urls: [],
              reel_count_total: 0,
              badge: "none"
            }
          : {
              sender_id_local: uuid(),
              display_name: senderName,
              occurrences: [],
              reel_urls: [],
              reel_count_total: 0,
              active: true,
              hidden: false,
              badge: "none"
            };
        senderMap.set(senderName, s);
      }

      s.occurrences.push({
        file_id: f.id,
        file_name: f.name,
        participant_name: senderName,
        reel_count: urls.length
      });

      const merged = new Set([...(s.reel_urls || []), ...(urls || [])]);
      s.reel_urls = Array.from(merged);
      s.reel_count_total = s.reel_urls.length;

      const fileSet = new Set(s.occurrences.map(o => o.file_id));
      s.badge = fileSet.size >= 2 ? "auto" : "none";
    }
  }

  // Rebuild reelItemsByUrl depuis les senders
  for (const s of senderMap.values()) {
    for (const url of s.reel_urls) {
      if (!reelItemsByUrl[url]) reelItemsByUrl[url] = { url, sender_local_ids: [] };
      if (!reelItemsByUrl[url].sender_local_ids.includes(s.sender_id_local)) {
        reelItemsByUrl[url].sender_local_ids.push(s.sender_id_local);
      }
    }
  }

  const senders = Array.from(senderMap.values());
  const stats = computeStats(senders, reelItemsByUrl, files);
  return { senders, reelItemsByUrl, stats };
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      local_room_id: null,
      files: [],
      senders: [],
      reelItemsByUrl: {},
      stats: EMPTY_STATS,
      parsing_busy: false,

      createLocalRoom: () => {
        const id = uuid();
        set({ local_room_id: id, files: [], senders: [], reelItemsByUrl: {}, stats: EMPTY_STATS });
      },

      reset: () => {
        set({
          local_room_id: null,
          files: [],
          senders: [],
          reelItemsByUrl: {},
          stats: EMPTY_STATS,
          join_code: undefined,
          master_key: undefined
        });
      },

      setJoin: (join_code, master_key) => set({ join_code, master_key }),

      importFiles: async (files: File[]) => {
        set({ parsing_busy: true });
        try {
          const currentFiles = get().files;
          const prevSenders = get().senders;

          const newFileRows: DraftFile[] = [];

          for (const f of files) {
            const text = await f.text();
            let json: any = null;

            try {
              json = JSON.parse(text);
            } catch {
              newFileRows.push({
                id: uuid(),
                name: f.name,
                messages_found: 0,
                participants_found: 0,
                errors_count: 1,
                rejected_urls: ["INVALID_JSON"],
                sender_to_urls: {}
              });
              continue;
            }

            const rep = parseInstagramExportJson(json);
            newFileRows.push({
              id: uuid(),
              name: f.name,
              messages_found: rep.messages_found,
              participants_found: rep.participants_found,
              errors_count: rep.errors_count,
              rejected_urls: rep.rejected_urls,
              sender_to_urls: rep.sender_to_urls
            });
          }

          const allFiles = [...currentFiles, ...newFileRows];
          const rebuilt = rebuildFromFiles(allFiles, prevSenders);

          set({
            files: allFiles,
            senders: rebuilt.senders,
            reelItemsByUrl: rebuilt.reelItemsByUrl,
            stats: rebuilt.stats
          });
        } finally {
          set({ parsing_busy: false });
        }
      },

      removeFile: async (fileId: string) => {
        set({ parsing_busy: true });
        try {
          const remaining = get().files.filter(f => f.id !== fileId);
          const rebuilt = rebuildFromFiles(remaining, get().senders);

          set({
            files: remaining,
            senders: rebuilt.senders,
            reelItemsByUrl: rebuilt.reelItemsByUrl,
            stats: rebuilt.stats
          });
        } finally {
          set({ parsing_busy: false });
        }
      },

      toggleSenderActive: (senderId: string) => {
        const senders = get().senders.map(s =>
          s.sender_id_local === senderId ? { ...s, active: !s.active } : s
        );
        const stats = computeStats(senders, get().reelItemsByUrl, get().files);
        set({ senders, stats });
      },

      renameSender: (senderId: string, name: string) => {
        const senders = get().senders.map(s =>
          s.sender_id_local === senderId ? { ...s, display_name: name } : s
        );
        set({ senders });
      }
    }),
    { name: "brp_draft_v1" }
  )
);
