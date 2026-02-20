import { redis } from "./redis";

export type GamePhase = "IN_GAME" | "GAME_END";
export type ItemPhase =
  | "ROUND_INIT"
  | "OPEN_REEL"
  | "VOTING"
  | "TIMER_RUNNING"
  | "REVEAL_SEQUENCE"
  | "ITEM_COMPLETE"
  | "ROUND_COMPLETE"
  | "GAME_END";

export type Sender = { id_local: string; name: string; active: boolean; photo_url?: string | null };
export type Player = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  photo_url: string | null;
  score: number;
};

export type RoundItem = {
  id: string;
  reel_item_id: string; // placeholder
  k: number;
  truth_sender_ids: string[];
  opened: boolean;
  resolved: boolean;
  order_index: number;
};

export type VoteState = {
  // item_id -> player_id -> sender_ids[]
  [item_id: string]: {
    [player_id: string]: string[];
  };
};

export type GameState = {
  room_code: string;
  master_key: string;
  join_code: string;

  seed: number;

  phase: GamePhase;
  current_phase: ItemPhase;
  current_round_index: number;
  current_item_index: number;

  timer_end_ts: number | null;

  created_at_ms: number;

  senders: Sender[];
  players: Player[];

  rounds: { index: number; items: RoundItem[] }[];

  votes: VoteState; // persisted immediately on cast_vote
};

const KEY = (room: string) => `brp:game:${room}`;
const TTL_SECONDS = 60 * 60 * 6;

export async function getGame(room_code: string): Promise<GameState | null> {
  const raw = await redis.get(KEY(room_code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export async function saveGame(state: GameState): Promise<void> {
  await redis.set(KEY(state.room_code), JSON.stringify(state), "EX", TTL_SECONDS);
}
