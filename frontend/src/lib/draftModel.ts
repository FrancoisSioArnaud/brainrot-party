// frontend/src/lib/draftModel.ts

import type { DraftV1 } from "./storage";

export type CanonSenderId = string; // derived from normalized name

export function normalizeSenderNameStrict(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveMergeRoot(
  id: string,
  merge_map: Record<string, string>
): string {
  let cur = id;
  const seen = new Set<string>();
  while (merge_map[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = merge_map[cur];
  }
  return cur;
}

export type SenderRow = {
  sender_key: string; // canonical root key
  name: string; // display name
  active: boolean;
  reels_count: number;
  merged_children: string[];
};

export type ItemByUrl = {
  url: string;
  true_sender_keys: string[]; // canonical root keys
};

export function buildModel(draft: DraftV1): {
  items: ItemByUrl[];
  senders: SenderRow[];
  stats: {
    shares_total: number;
    urls_unique: number;
    senders_total: number;
    senders_active: number;
    multi_sender_items: number;
  };
} {
  const merge_map = draft.merge_map || {};
  const active_map = draft.active_map || {};

  // url -> set(root_sender)
  const urlSenders = new Map<string, Set<string>>();
  // root_sender -> set(original sender strict key)
  const rootChildren = new Map<string, Set<string>>();
  // root_sender -> display name (best effort)
  const rootDisplay = new Map<string, string>();

  for (const sh of draft.shares) {
    const base = normalizeSenderNameStrict(sh.sender_name);
    const root = resolveMergeRoot(base, merge_map);

    if (!rootDisplay.has(root)) rootDisplay.set(root, sh.sender_name.trim());
    if (!rootChildren.has(root)) rootChildren.set(root, new Set());
    rootChildren.get(root)!.add(base);

    if (!urlSenders.has(sh.url)) urlSenders.set(sh.url, new Set());
    urlSenders.get(sh.url)!.add(root);
  }

  const items: ItemByUrl[] = Array.from(urlSenders.entries()).map(
    ([url, set]) => ({
      url,
      true_sender_keys: Array.from(set).sort(),
    })
  );

  // sender -> reels_count based on items membership
  const reelsCount = new Map<string, number>();
  for (const it of items) {
    for (const s of it.true_sender_keys) {
      reelsCount.set(s, (reelsCount.get(s) ?? 0) + 1);
    }
  }

  const senders: SenderRow[] = Array.from(
    new Set(Array.from(rootChildren.keys()))
  ).map((root) => {
    const active = active_map[root] ?? true;
    return {
      sender_key: root,
      name: rootDisplay.get(root) ?? root,
      active,
      reels_count: reelsCount.get(root) ?? 0,
      merged_children: Array.from(rootChildren.get(root) ?? [])
        .filter((x) => x !== root)
        .sort(),
    };
  });

  senders.sort((a, b) => {
    if (b.reels_count !== a.reels_count) return b.reels_count - a.reels_count;
    return a.name.localeCompare(b.name);
  });

  const senders_active = senders.filter((s) => s.active).length;
  const multi_sender_items = items.filter((i) => i.true_sender_keys.length > 1)
    .length;

  return {
    items,
    senders,
    stats: {
      shares_total: draft.shares.length,
      urls_unique: items.length,
      senders_total: senders.length,
      senders_active,
      multi_sender_items,
    },
  };
}

export function applyMerge(
  draft: DraftV1,
  from_sender_key: string,
  into_sender_key: string
): DraftV1 {
  const from = normalizeSenderNameStrict(from_sender_key);
  const into = normalizeSenderNameStrict(into_sender_key);
  if (!from || !into || from === into) return draft;

  const merge_map = { ...(draft.merge_map || {}) };
  merge_map[from] = into;

  const active_map = { ...(draft.active_map || {}) };
  // keep target active state; drop from state
  delete active_map[from];

  return { ...draft, merge_map, active_map, updated_at: Date.now() };
}

export function removeMerge(draft: DraftV1, from_sender_key: string): DraftV1 {
  const from = normalizeSenderNameStrict(from_sender_key);
  const merge_map = { ...(draft.merge_map || {}) };
  if (!merge_map[from]) return draft;
  delete merge_map[from];
  return { ...draft, merge_map, updated_at: Date.now() };
}

export function toggleSenderActive(
  draft: DraftV1,
  sender_key: string,
  active: boolean
): DraftV1 {
  const k = normalizeSenderNameStrict(sender_key);
  const active_map = { ...(draft.active_map || {}) };
  active_map[k] = active;
  return { ...draft, active_map, updated_at: Date.now() };
}
