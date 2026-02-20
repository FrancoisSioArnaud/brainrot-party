import { redis } from "./redis";

export type GameState = {
  room_code: string;
  master_key: string;
  // minimal; expanded in later steps
  phase: string;
  timer_end_ts: number | null;
};

const KEY = (room: string) => `brp:game:${room}`;
const TTL_SECONDS = 60 * 60 * 6;

export async function getGame(room_code: string): Promise<GameState | null> {
  const raw = await redis.get(KEY(room_code));
  if (!raw) return null;
  try { return JSON.parse(raw) as GameState; } catch { return null; }
}

export async function saveGame(state: GameState): Promise<void> {
  await redis.set(KEY(state.room_code), JSON.stringify(state), "EX", TTL_SECONDS);
}
