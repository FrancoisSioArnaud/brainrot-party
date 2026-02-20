export type NormalizeResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const RE = /^https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i;

export function normalizeInstagramUrl(raw: string): NormalizeResult {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "empty" };
  const s = raw.trim();
  const m = s.match(RE);
  if (!m) return { ok: false, reason: "pattern_mismatch" };
  const kind = m[2].toLowerCase();
  const shortcode = m[3];
  const url = `https://www.instagram.com/${kind}/${shortcode}/`;
  return { ok: true, url };
}
