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
  return crypto.randomUUID();
}

// -------------------------
// Master Draft (Setup)
// -------------------------

export type DraftImportReportV1 = {
  file_name: string;
  shares_added: number;
  rejected_count: number;
  rejected_samples: Array<{ reason: string; sample: string }>;
  participants_detected: string[];
};

export type DraftShareV1 = {
  url: string;
  sender_name: string;
  file_name?: string;
};

export type DraftV1 = {
  v: 1;
  room_code: string;

  shares: DraftShareV1[];
  import_reports: DraftImportReportV1[];

  merge_map: Record<string, string>;
  active_map: Record<string, boolean>;

  name_overrides: Record<string, string>;

  seed: string;
  k_max: number;

  // Step 3: lock local après envoi setup
  setup_sent_at?: number;

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
    if (!d || d.v !== 1) return null;
    if ((d.room_code ?? "").toUpperCase() !== room_code.toUpperCase()) return null;

    if (typeof d.seed !== "string") (d as any).seed = "";
    if (typeof d.k_max !== "number") (d as any).k_max = 4;
    if (!Array.isArray(d.import_reports)) (d as any).import_reports = [];
    if (!d.name_overrides || typeof d.name_overrides !== "object") (d as any).name_overrides = {};

    // backfill
    if (typeof (d as any).setup_sent_at !== "number") (d as any).setup_sent_at = undefined;
    (d.import_reports as any[]).forEach((r) => {
      if (!Array.isArray(r.participants_detected)) r.participants_detected = [];
    });

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
