import { normalizeInstagramUrl } from "./normalizeInstagramUrl";

export type ParsedFileReport = {
  messages_found: number;
  participants_found: number;
  errors_count: number;
  rejected_urls: string[];
  sender_to_urls: Record<string, string[]>; // sender name => normalized urls (dedup within sender)
};

function safeGetSenderName(msg: any): string | null {
  // Instagram exports vary; try common keys
  return (
    msg?.sender_name ??
    msg?.sender ??
    msg?.from ??
    msg?.user ??
    msg?.profile ??
    null
  );
}

function safeGetShareLink(msg: any): string | null {
  // spec: messages[].share.link
  return msg?.share?.link ?? null;
}

export function parseInstagramExportJson(json: any): ParsedFileReport {
  const messages: any[] = Array.isArray(json?.messages) ? json.messages : [];
  const sender_to_urls: Record<string, Set<string>> = {};
  const rejected_urls: string[] = [];

  for (const msg of messages) {
    const sender = safeGetSenderName(msg);
    const link = safeGetShareLink(msg);
    if (!sender || !link) continue;

    const norm = normalizeInstagramUrl(link);
    if (!norm.ok) {
      rejected_urls.push(link);
      continue;
    }

    if (!sender_to_urls[sender]) sender_to_urls[sender] = new Set<string>();
    sender_to_urls[sender].add(norm.url);
  }

  const participants_found = Object.keys(sender_to_urls).length;

  const out: Record<string, string[]> = {};
  for (const [sender, set] of Object.entries(sender_to_urls)) out[sender] = Array.from(set);

  return {
    messages_found: messages.length,
    participants_found,
    errors_count: rejected_urls.length,
    rejected_urls,
    sender_to_urls: out
  };
}
