import type { DraftV1 } from "./storage";

export function normalizeSenderNameStrict(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveMergeRoot(id: string, merge_map: Record<string, string>): string {
  let cur = id;
  const seen = new Set<string>();
  while (merge_map[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = merge_map[cur];
  }
  return cur;
}

export function hasMergeLoop(merge_map: Record<string, string>): boolean {
  const keys = Object.keys(merge_map);
  for (const k of keys) {
    let cur = k;
    const seen = new Set<string>();
    while (merge_map[cur]) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = merge_map[cur];
    }
  }
  return false;
}

export type SenderRow = {
  sender_key: string; // root key
  name: string; // display
  active: boolean;
  reels_count: number;
  merged_children: string[];
};

export type ItemByUrl = {
  url: string;
  true_sender_keys: string[]; // root keys
};

export type DraftStats = {
  files_count: number;
  shares_total: number;
  urls_unique: number;
  urls_multi_sender: number;
  senders_total: number;
  senders_active: number;
  reels_min: number;
  reels_median: number;
  reels_max: number;
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

export function buildModel(draft: DraftV1): {
  items: ItemByUrl[];
  senders: SenderRow[];
  stats: DraftStats;
  senderNameByKey: Record<string, string>;
} {
  const merge_map = draft.merge_map || {};
  const active_map = draft.active_map || {};

  // url -> set(root_sender)
  const urlSenders = new Map<string, Set<string>>();
  // root_sender -> set(original strict keys)
  const rootChildren = new Map<string, Set<string>>();
  // root_sender -> display name (first seen)
  const rootDisplay = new Map<string, string>();

  const filesSet = new Set<string>();
  for (const sh of draft.shares) {
    if (sh.file_name) filesSet.add(sh.file_name);

    const base = normalizeSenderNameStrict(sh.sender_name);
    const root = resolveMergeRoot(base, merge_map);

    if (!rootDisplay.has(root)) rootDisplay.set(root, sh.sender_name.trim());
    if (!rootChildren.has(root)) rootChildren.set(root, new Set());
    rootChildren.get(root)!.add(base);

    if (!urlSenders.has(sh.url)) urlSenders.set(sh.url, new Set());
    urlSenders.get(sh.url)!.add(root);
  }

  const items: ItemByUrl[] = Array.from(urlSenders.entries()).map(([url, set]) => ({
    url,
    true_sender_keys: Array.from(set).sort(),
  }));

  // reels count per sender (based on unique urls)
  const reelsCount = new Map<string, number>();
  for (const it of items) {
    for (const s of it.true_sender_keys) reelsCount.set(s, (reelsCount.get(s) ?? 0) + 1);
  }

  const senderNameByKey: Record<string, string> = {};
  const senders: SenderRow[] = Array.from(new Set(Array.from(rootChildren.keys()))).map((root) => {
    const active = active_map[root] ?? true;
    const name = rootDisplay.get(root) ?? root;
    senderNameByKey[root] = name;
    return {
      sender_key: root,
      name,
      active,
      reels_count: reelsCount.get(root) ?? 0,
      merged_children: Array.from(rootChildren.get(root) ?? [])
        .filter((x) => x !== root)
        .sort(),
    };
  });

  senders.sort((a, b) => {
    // active first, then reels desc, then alpha
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.reels_count !== a.reels_count) return b.reels_count - a.reels_count;
    return a.name.localeCompare(b.name);
  });

  const activeSenders = senders.filter((s) => s.active && s.reels_count > 0);
  const reelsList = activeSenders.map((s) => s.reels_count);
  const urls_multi_sender = items.filter((i) => i.true_sender_keys.length > 1).length;

  return {
    items,
    senders,
    senderNameByKey,
    stats: {
      files_count: filesSet.size || draft.import_reports.length,
      shares_total: draft.shares.length,
      urls_unique: items.length,
      urls_multi_sender,
      senders_total: senders.length,
      senders_active: senders.filter((s) => s.active).length,
      reels_min: reelsList.length ? Math.min(...reelsList) : 0,
      reels_median: median(reelsList),
      reels_max: reelsList.length ? Math.max(...reelsList) : 0,
    },
  };
}

export function applyMerge(draft: DraftV1, from_sender_key: string, into_sender_key: string): DraftV1 {
  const from = normalizeSenderNameStrict(from_sender_key);
  const into = normalizeSenderNameStrict(into_sender_key);
  if (!from || !into || from === into) return draft;

  const merge_map = { ...(draft.merge_map || {}) };
  merge_map[from] = into;

  // guard loop
  if (hasMergeLoop(merge_map)) return draft;

  const active_map = { ...(draft.active_map || {}) };
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

export function toggleSenderActive(draft: DraftV1, sender_key: string, active: boolean): DraftV1 {
  const k = normalizeSenderNameStrict(sender_key);
  const active_map = { ...(draft.active_map || {}) };
  active_map[k] = active;
  return { ...draft, active_map, updated_at: Date.now() };
}
