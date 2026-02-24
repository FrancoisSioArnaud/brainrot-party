const KEY_MASTER = "brp_master_v1";
const KEY_PLAY = "brp_play_v1";

export type MasterSession = {
  room_code: string;
  master_key: string;
};

export type PlaySession = {
  room_code: string;
  device_id: string;
};

export function loadMasterSession(): MasterSession | null {
  try {
    const raw = localStorage.getItem(KEY_MASTER);
    if (!raw) return null;
    return JSON.parse(raw) as MasterSession;
  } catch {
    return null;
  }
}

export function saveMasterSession(s: MasterSession) {
  localStorage.setItem(KEY_MASTER, JSON.stringify(s));
}

export function clearMasterSession() {
  localStorage.removeItem(KEY_MASTER);
}

export function loadPlaySession(): PlaySession | null {
  try {
    const raw = localStorage.getItem(KEY_PLAY);
    if (!raw) return null;
    return JSON.parse(raw) as PlaySession;
  } catch {
    return null;
  }
}

export function savePlaySession(s: PlaySession) {
  localStorage.setItem(KEY_PLAY, JSON.stringify(s));
}

export function clearPlaySession() {
  localStorage.removeItem(KEY_PLAY);
}

export function ensureDeviceId(existing?: string | null): string {
  if (existing && existing.length >= 8) return existing;
  // simple stable-ish id
  const id = crypto.randomUUID();
  return id;
}
