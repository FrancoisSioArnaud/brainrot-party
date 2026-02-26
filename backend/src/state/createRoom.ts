import type { Phase, RoundId, PlayerId, SenderId } from "@brp/contracts";
import type { RoundItem } from "@brp/contracts";

export type GameStatus = "idle" | "reveal" | "vote" | "reveal_wait";

export type GameInternal = {
  current_round_index: number;
  current_item_index: number;
  status: GameStatus;
  expected_player_ids: PlayerId[];
  votes: Record<PlayerId, SenderId[]>;
};

export type PlayerInternal = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;
  active: boolean;
  name: string;
  avatar_url: string | null;
  claimed_by?: string;
};

export type SenderInternal = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
};

export type RoomStateInternal = {
  room_code: string;
  phase: Phase;
  setup: {
    rounds: {
      round_id: RoundId;
      items: RoundItem[];
    }[];
  } | null;
  players: PlayerInternal[];
  senders: SenderInternal[];
  scores: Record<PlayerId, number>;
  game: GameInternal | null;
};

export function createInitialRoomState(room_code: string): RoomStateInternal {
  return {
    room_code,
    phase: "lobby",
    setup: null,
    players: [],
    senders: [],
    scores: {},
    game: null,
  };
}
