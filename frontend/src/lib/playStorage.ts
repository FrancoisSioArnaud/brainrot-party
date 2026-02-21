// frontend/src/lib/playStorage.ts

const K_DEVICE = "brp_device_id";
const K_ROOM = "brp_current_room_code";
const K_PLAYER_ID = "brp_player_id";
const K_PLAYER_TOKEN = "brp_player_session_token";
const K_LAST_ERROR = "brp_play_last_error";

export function normalizeJoinCode(v: string): string {
  return (v || "").trim().toUpperCase();
}

export function isValidJoinCode(v: string): boolean {
  const s = normalizeJoinCode(v);
  return /^[A-Z0-9]{6}$/.test(s);
}

export function setLastError(msg: string) {
  localStorage.setItem(K_LAST_ERROR, msg);
}

export function readAndClearLastError(): string {
  const v = localStorage.getItem(K_LAST_ERROR) || "";
  if (v) localStorage.removeItem(K_LAST_ERROR);
  return v;
}

export function getOrCreateDeviceId(): string {
  const cur = localStorage.getItem(K_DEVICE);
  if (cur) return cur;
  const id = crypto.randomUUID();
  localStorage.setItem(K_DEVICE, id);
  return id;
}

export function getCurrentRoomCode(): string | null {
  return localStorage.getItem(K_ROOM);
}

export function setCurrentRoomCode(code: string) {
  localStorage.setItem(K_ROOM, code);
}

export function getClaim():
  | { player_id: string; player_session_token: string }
  | null {
  const player_id = localStorage.getItem(K_PLAYER_ID);
  const player_session_token = localStorage.getItem(K_PLAYER_TOKEN);
  if (!player_id || !player_session_token) return null;
  return { player_id, player_session_token };
}

export function setClaim(player_id: string, player_session_token: string) {
  localStorage.setItem(K_PLAYER_ID, player_id);
  localStorage.setItem(K_PLAYER_TOKEN, player_session_token);
}

export function clearClaim() {
  localStorage.removeItem(K_PLAYER_ID);
  localStorage.removeItem(K_PLAYER_TOKEN);
}

export function wipePlayStateExceptDevice() {
  localStorage.removeItem(K_ROOM);
  clearClaim();
}
