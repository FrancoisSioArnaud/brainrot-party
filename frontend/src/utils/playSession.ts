export type PlaySession = {
  join_code: string;
  player_id: string;
  player_token: string;
};

const KEY = "brp_play_session_v1";
const ERR_KEY = "brp_play_error_once";

export function setPlaySession(s: PlaySession) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getPlaySession(): PlaySession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j?.join_code || !j?.player_id || !j?.player_token) return null;
    return j as PlaySession;
  } catch {
    return null;
  }
}

export function clearPlaySession() {
  localStorage.removeItem(KEY);
}

export function setOneShotError(message: string) {
  sessionStorage.setItem(ERR_KEY, message);
}

export function popOneShotError(): string | null {
  const m = sessionStorage.getItem(ERR_KEY);
  if (!m) return null;
  sessionStorage.removeItem(ERR_KEY);
  return m;
}
