import { redis } from "./redis";
import { makeJoinCode, makeMasterKey } from "../utils";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;

  active: boolean;

  // ✅ current name
  name: string;

  // ✅ original name (used by "Reset nom")
  original_name: string;

  status: "free" | "connected" | "afk" | "disabled";

  device_id: string | null;
  player_session_token: string | null;

  photo_url: string | null;

  last_ping_ms: number | null;

  afk_expires_at_ms: number | null;
};

export type LobbyState = {
  lobby_id: string;
  join_code: string;
  master_key: string;
  local_room_id: string;
  created_at_ms: number;

  senders: Array<{ id_local: string; name: string; active: boolean }>;
  players: LobbyPlayer[];
};

const KEY = (join: string) => `brp:lobby:${join}`;
const LOBBY_TTL_SECONDS = 60 * 60; // 1h

export async function createLobby(local_room_id: string): Promise<{ join_code: string; master_key: string }> {
  for (let i = 0; i < 20; i++) {
    const join_code = makeJoinCode();
    const exists = await redis.exists(KEY(join_code));
    if (exists) continue;

    const master_key = makeMasterKey();
    const state: LobbyState = {
      lobby_id: `lobby_${join_code}`,
      join_code,
      master_key,
      local_room_id,
      created_at_ms: Date.now(),
      senders: [],
      players: []
    };

    await redis.set(KEY(join_code), JSON.stringify(state), "EX", LOBBY_TTL_SECONDS);
    return { join_code, master_key };
  }
  throw new Error("failed_to_create_lobby");
}

export async function getLobby(join_code: string): Promise<LobbyState | null> {
  const raw = await redis.get(KEY(join_code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LobbyState;
  } catch {
    return null;
  }
}

export async function saveLobby(state: LobbyState): Promise<void> {
  await redis.set(KEY(state.join_code), JSON.stringify(state), "EX", LOBBY_TTL_SECONDS);
}

export async function deleteLobby(join_code: string): Promise<void> {
  await redis.del(KEY(join_code));
}
