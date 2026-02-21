// frontend/src/lib/playStorage.ts

const K_DEVICE = "brp_device_id";
const K_ROOM = "brp_current_room_code";
const K_PLAYER_ID = "brp_player_id";
const K_PLAYER_TOKEN = "brp_player_session_token";

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

export function clearRoomAndClaim() {
  localStorage.removeItem(K_ROOM);
  localStorage.removeItem(K_PLAYER_ID);
  localStorage.removeItem(K_PLAYER_TOKEN);
}

export function getClaim(): { playerId: string; token: string } | null {
  const playerId = localStorage.getItem(K_PLAYER_ID);
  const token = localStorage.getItem(K_PLAYER_TOKEN);
  if (!playerId || !token) return null;
  return { playerId, token };
}

export function setClaim(playerId: string, token: string) {
  localStorage.setItem(K_PLAYER_ID, playerId);
  localStorage.setItem(K_PLAYER_TOKEN, token);
}

export function clearClaim() {
  localStorage.removeItem(K_PLAYER_ID);
  localStorage.removeItem(K_PLAYER_TOKEN);
}

// wipe Play state except device id
export function wipePlayStateExceptDevice() {
  clearRoomAndClaim();
}
