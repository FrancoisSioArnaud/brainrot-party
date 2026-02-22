// frontend/src/lib/playStorage.ts

const K_DEVICE_ID = "brp_device_id";
const K_ROOM_CODE = "brp_current_room_code"; // join_code lobby
const K_PLAYER_ID = "brp_player_id";
const K_PLAYER_TOKEN = "brp_player_session_token";
const K_LAST_ERROR = "brp_play_last_error";

export function getOrCreateDeviceId(): string {
  const cur = localStorage.getItem(K_DEVICE_ID);
  if (cur) return cur;
  const id = crypto.randomUUID();
  localStorage.setItem(K_DEVICE_ID, id);
  return id;
}

export function getCurrentRoomCode(): string | null {
  return localStorage.getItem(K_ROOM_CODE);
}

export function setCurrentRoomCode(code: string) {
  localStorage.setItem(K_ROOM_CODE, code);
}

export function getClaim(): { player_id: string | null; player_session_token: string | null } {
  return {
    player_id: localStorage.getItem(K_PLAYER_ID),
    player_session_token: localStorage.getItem(K_PLAYER_TOKEN),
  };
}

export function setClaim(player_id: string, player_session_token: string) {
  localStorage.setItem(K_PLAYER_ID, player_id);
  localStorage.setItem(K_PLAYER_TOKEN, player_session_token);
}

export function clearClaim() {
  localStorage.removeItem(K_PLAYER_ID);
  localStorage.removeItem(K_PLAYER_TOKEN);
}

/**
 * Clear only the player claim (player_id + token) but keep the current lobby code.
 * Used for "Changer de player".
 */
export function clearClaimOnly() {
  clearClaim();
}

/**
 * Wipe everything related to Play session except the stable device id.
 * Used when switching lobby, kick, lobby closed, etc.
 */
export function wipePlayStateExceptDevice() {
  localStorage.removeItem(K_ROOM_CODE);
  clearClaim();
}

export function setLastError(msg: string) {
  localStorage.setItem(K_LAST_ERROR, msg);
}

/**
 * Read and clear last error (display once on /play).
 */
export function readAndClearLastError(): string | null {
  const v = localStorage.getItem(K_LAST_ERROR);
  if (v) localStorage.removeItem(K_LAST_ERROR);
  return v;
}

export function normalizeJoinCode(raw: string): string {
  return (raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidJoinCode(raw: string): boolean {
  const code = normalizeJoinCode(raw);
  if (code.length !== 6) return false;

  // LLDDLL, letters exclude I/O
  const L = "[A-HJ-NP-Z]";
  const D = "[0-9]";
  const re = new RegExp(`^${L}${L}${D}${D}${L}${L}$`);
  return re.test(code);
}
