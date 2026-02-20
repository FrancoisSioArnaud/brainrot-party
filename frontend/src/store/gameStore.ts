import { create } from "zustand";

export type GameSender = { id: string; name: string; photo_url: string | null; color_token?: string; active: boolean };
export type GamePlayer = { id: string; name: string; photo_url: string | null; active: boolean; score: number; connected?: boolean };

export type RoundItemSummary = { id: string; k: number; opened: boolean; resolved: boolean };

type GameRoom = {
  room_code: string;
  status: "IN_GAME" | "GAME_END";
  phase: string;
  current_round_index: number;
  current_item_index: number;
  timer_end_ts: number | null;
};

type GameState = {
  room: GameRoom | null;
  senders: GameSender[];
  players: GamePlayer[];
  items: RoundItemSummary[];
  focus_item_id: string | null;

  remaining_sender_ids: string[];
  revealed_slots_by_item: Record<string, string[]>;
  current_votes_by_player: Record<string, string[]>;

  reel_urls_by_item?: Record<string, string>; // master-only

  applyStateSync: (payload: any) => void;
  applyRevealStep: (payload: any) => void;
};

export const useGameStore = create<GameState>((set, get) => ({
  room: null,
  senders: [],
  players: [],
  items: [],
  focus_item_id: null,
  remaining_sender_ids: [],
  revealed_slots_by_item: {},
  current_votes_by_player: {},

  applyStateSync: (p) => {
    set({
      room: p.room,
      senders: p.senders || [],
      players: p.players || [],
      items: p.round?.items_ordered || [],
      focus_item_id: p.round?.focus_item_id || null,
      remaining_sender_ids: p.ui_state?.remaining_sender_ids || [],
      revealed_slots_by_item: p.ui_state?.revealed_slots_by_item || {},
      current_votes_by_player: p.ui_state?.current_votes_by_player || {},
      reel_urls_by_item: p.ui_state?.reel_urls_by_item
    });
  },

  applyRevealStep: (payload) => {
    // The UI components will interpret payload; store minimal shared fields
    if (payload.step === 4 && payload.scores) {
      const players = get().players.map(pl => ({
        ...pl,
        score: payload.scores[pl.id] ?? pl.score
      }));
      set({ players });
    }
    if (payload.step === 5) {
      if (payload.remaining_sender_ids) set({ remaining_sender_ids: payload.remaining_sender_ids });
      if (payload.item_id && payload.truth_sender_ids) {
        const cur = { ...get().revealed_slots_by_item };
        cur[payload.item_id] = payload.truth_sender_ids;
        set({ revealed_slots_by_item: cur });
      }
    }
    if (payload.step === 6) {
      set({ current_votes_by_player: {} });
    }
  }
}));
