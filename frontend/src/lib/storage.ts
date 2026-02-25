const KEY_MASTER = "brp_master_v1";
const KEY_PLAY = "brp_play_v1";
const KEY_DRAFT_PREFIX = "brp_draft_v1"; // per-room

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

// -------------------------
// Master Draft (Setup)
// -------------------------

export type DraftV1 = {
  v: 1;
  room_code: string;
  /** Raw shares extracted from IG JSON exports */
  shares: Array<{ url: string; sender_name: string }>;
  /** Manual merge: canonical_sender -> canonical_target */
  merge_map: Record<string, string>;
  /** Active toggle per canonical (root) sender */
  active_map: Record<string, boolean>;
  /** Optional seed for deterministic generation */
  seed?: string;
  updated_at: number;
};

function draftKey(room_code: string): string {
  return `${KEY_DRAFT_PREFIX}:${room_code.toUpperCase()}`;
}

export function loadDraft(room_code: string): DraftV1 | null {
  try {
    const raw = localStorage.getItem(draftKey(room_code));
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftV1;
    if (!d || d.v !== 1 || !d.room_code) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(d: DraftV1) {
  localStorage.setItem(draftKey(d.room_code), JSON.stringify(d));
}

export function clearDraft(room_code: string) {
  localStorage.removeItem(draftKey(room_code));
}
