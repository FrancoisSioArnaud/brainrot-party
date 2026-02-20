import { redis } from "./redis";

export type GameState = {
  room_code: string;
  master_key: string;
  // minimal; expanded later
  phase: "IN_GAME" | "GAME_END";
  timer_end_ts: number | null;

  // snapshot from Lobby (MVP)
  created_at_ms: number;
  join_code: string;
  senders: Array<{ id_local: string; name: string; active: boolean }>;
  players: Array<{
    id: string;
    type: "sender_linked" | "manual";
    sender_id_local: string | null;
    active: boolean;
    name: string;
    photo_url: string | null;
    score: number;
  }>;
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
