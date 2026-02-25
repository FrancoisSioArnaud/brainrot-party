// frontend/src/lib/igImport.ts

export type IgImportShare = {
  url: string;
  sender_name: string;
};

export type IgImportResult = {
  shares: IgImportShare[];
  rejected: Array<{ reason: string; sample: string }>;
};

function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  // Some exports have escaped urls or missing protocol
  if (s.startsWith("www.")) s = `https://${s}`;
  if (s.startsWith("instagram.com")) s = `https://${s}`;

  try {
    const u = new URL(s);
    if (!u.hostname.includes("instagram.com")) return null;

    // Keep only reel links (strict)
    const p = u.pathname.replace(/\/+$/, "");
    const isReel = p.startsWith("/reel/") || p.startsWith("/reels/");
    if (!isReel) return null;

    // Strip tracking
    u.search = "";
    u.hash = "";
    // Force https
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function getString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function getSenderNameFromNode(node: Record<string, unknown>): string | null {
  // Common fields across IG exports
  const a = getString(node["sender_name"]);
  if (a) return a;
  const b = getString(node["sender"]);
  if (b) return b;
  const c = getString(node["from"]);
  if (c) return c;
  return null;
}

function collectSharesDeep(
  node: unknown,
  out: IgImportShare[],
  rejected: IgImportResult["rejected"]
) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const it of node) collectSharesDeep(it, out, rejected);
    return;
  }
  if (!isObject(node)) return;

  // Heuristic 1: direct fields "share" or "link"
  const sender = getSenderNameFromNode(node);

  const directLink = getString(node["link"]) ?? getString(node["url"]);
  if (sender && directLink) {
    const nu = normalizeUrl(directLink);
    if (nu) out.push({ url: nu, sender_name: sender });
  }

  // Heuristic 2: node.share.link
  const share = node["share"];
  if (sender && isObject(share)) {
    const link = getString(share["link"]) ?? getString(share["url"]);
    if (link) {
      const nu = normalizeUrl(link);
      if (nu) out.push({ url: nu, sender_name: sender });
    }
  }

  // Heuristic 3: text content containing an instagram reel url
  const content = getString(node["content"]) ?? getString(node["text"]) ?? null;
  if (sender && content && content.includes("instagram.com")) {
    // Extract first URL-like token
    const m =
      content.match(/https?:\/\/[^\s)\]}>"]+/i) ||
      content.match(/(?:www\.)instagram\.com\/[^\s)\]}>"]+/i);
    if (m?.[0]) {
      const nu = normalizeUrl(m[0]);
      if (nu) out.push({ url: nu, sender_name: sender });
    }
  }

  // Recurse
  for (const k of Object.keys(node)) {
    collectSharesDeep(node[k], out, rejected);
  }
}

export async function importInstagramJsonFiles(
  files: File[]
): Promise<IgImportResult> {
  const shares: IgImportShare[] = [];
  const rejected: IgImportResult["rejected"] = [];

  for (const f of files) {
    let text = "";
    try {
      text = await f.text();
    } catch {
      rejected.push({ reason: "read_failed", sample: f.name });
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      rejected.push({ reason: "json_parse_failed", sample: f.name });
      continue;
    }

    collectSharesDeep(json, shares, rejected);
  }

  // De-dupe exact (url+sender) to reduce noise
  const seen = new Set<string>();
  const out: IgImportShare[] = [];
  for (const s of shares) {
    const key = `${s.sender_name}::${s.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  return { shares: out, rejected };
}
