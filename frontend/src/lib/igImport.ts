export type IgImportShare = {
  url: string;
  sender_name: string;
  file_name?: string;
};

export type IgRejected = { reason: string; sample: string };

export type IgImportResult = {
  shares: IgImportShare[];
  rejected: IgRejected[];
  by_file: Array<{
    file_name: string;
    shares_added: number;
    rejected_count: number;
    rejected_samples: IgRejected[];
    participants_detected: string[]; // NEW
  }>;
};

function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  if (s.startsWith("www.")) s = `https://${s}`;
  if (s.startsWith("instagram.com")) s = `https://${s}`;

  try {
    const u = new URL(s);
    if (!u.hostname.includes("instagram.com")) return null;

    const p = u.pathname.replace(/\/+$/, "");
    const isReel = p.startsWith("/reel/") || p.startsWith("/reels/");
    if (!isReel) return null;

    u.search = "";
    u.hash = "";
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
  const a = getString(node["sender_name"]);
  if (a) return a;
  const b = getString(node["sender"]);
  if (b) return b;
  const c = getString(node["from"]);
  if (c) return c;
  const d = getString(node["participant_name"]);
  if (d) return d;
  return null;
}

function pushRejected(rejected: IgRejected[], reason: string, sample: string) {
  if (rejected.length >= 5000) return;
  rejected.push({ reason, sample: sample.slice(0, 180) });
}

function extractUrlFromText(text: string): string | null {
  const m =
    text.match(/https?:\/\/[^\s)\]}>"]+/i) ||
    text.match(/(?:www\.)instagram\.com\/[^\s)\]}>"]+/i) ||
    text.match(/instagram\.com\/[^\s)\]}>"]+/i);
  return m?.[0] ?? null;
}

function collectSharesDeep(
  node: unknown,
  out: IgImportShare[],
  rejected: IgRejected[],
  file_name: string,
  participants: Set<string>
) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const it of node) collectSharesDeep(it, out, rejected, file_name, participants);
    return;
  }
  if (!isObject(node)) return;

  const sender = getSenderNameFromNode(node);
  if (sender) participants.add(sender.trim());

  // direct fields
  const directLink = getString(node["link"]) ?? getString(node["url"]);
  if (sender && directLink) {
    const nu = normalizeUrl(directLink);
    if (nu) out.push({ url: nu, sender_name: sender, file_name });
    else pushRejected(rejected, "not_a_reel_url", directLink);
  }

  // node.share.link
  const share = node["share"];
  if (sender && isObject(share)) {
    const link = getString(share["link"]) ?? getString(share["url"]);
    if (link) {
      const nu = normalizeUrl(link);
      if (nu) out.push({ url: nu, sender_name: sender, file_name });
      else pushRejected(rejected, "not_a_reel_url", link);
    }
  }

  // text containing url
  const content = getString(node["content"]) ?? getString(node["text"]) ?? null;
  if (sender && content && content.includes("instagram.com")) {
    const token = extractUrlFromText(content);
    if (token) {
      const nu = normalizeUrl(token);
      if (nu) out.push({ url: nu, sender_name: sender, file_name });
      else pushRejected(rejected, "not_a_reel_url", token);
    }
  }

  for (const k of Object.keys(node)) collectSharesDeep(node[k], out, rejected, file_name, participants);
}

export async function importInstagramJsonFiles(files: File[]): Promise<IgImportResult> {
  const allShares: IgImportShare[] = [];
  const allRejected: IgRejected[] = [];
  const by_file: IgImportResult["by_file"] = [];

  for (const f of files) {
    const fileRejected: IgRejected[] = [];
    const participants = new Set<string>();

    let text = "";
    try {
      text = await f.text();
    } catch {
      pushRejected(fileRejected, "read_failed", f.name);
      by_file.push({
        file_name: f.name,
        shares_added: 0,
        rejected_count: fileRejected.length,
        rejected_samples: fileRejected.slice(0, 200),
        participants_detected: [],
      });
      allRejected.push(...fileRejected);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      pushRejected(fileRejected, "json_parse_failed", f.name);
      by_file.push({
        file_name: f.name,
        shares_added: 0,
        rejected_count: fileRejected.length,
        rejected_samples: fileRejected.slice(0, 200),
        participants_detected: [],
      });
      allRejected.push(...fileRejected);
      continue;
    }

    const before = allShares.length;
    collectSharesDeep(json, allShares, fileRejected, f.name, participants);
    const added = allShares.length - before;

    by_file.push({
      file_name: f.name,
      shares_added: added,
      rejected_count: fileRejected.length,
      rejected_samples: fileRejected.slice(0, 200),
      participants_detected: Array.from(participants)
        .filter(Boolean)
        .slice(0, 60),
    });
    allRejected.push(...fileRejected);
  }

  // De-dupe globally by (sender_name + url)
  const seen = new Set<string>();
  const out: IgImportShare[] = [];
  for (const s of allShares) {
    const key = `${s.sender_name}::${s.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  return { shares: out, rejected: allRejected, by_file };
}
