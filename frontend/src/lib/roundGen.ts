import type { SenderAll } from "@brp/contracts";
import type { ItemByUrl, SenderRow } from "./draftModel";

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stableShuffle<T>(arr: T[], seedStr: string): T[] {
  const rnd = mulberry32(hash32(seedStr));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function senderIdFromNameKey(k: string): string {
  return `s_${hash32(k).toString(16)}`;
}
function reelIdFromUrl(url: string): string {
  return `r_${hash32(url).toString(16)}`;
}

export type SetupItem = {
  item_id: string;
  reel: { reel_id: string; url: string };
  k: number;
  true_sender_ids: string[];
};
export type SetupRound = {
  round_id: string;
  items: SetupItem[];
};

type ItemInternal = {
  url: string;
  true_sender_keys: string[]; // active roots only
  owner_key: string; // deterministic owner for balancing
  k_raw: number;
  multi: boolean;
};

function clampK(k_raw: number, k_max: number): number {
  const k = Math.max(1, k_raw);
  return Math.min(k, Math.max(1, k_max));
}

/**
 * Option B "full":
 * - Active senders only (with reels_count > 0)
 * - Multi-sender items first; within each sender queue: higher k first
 * - rounds_max = reels_count of 2nd active sender (desc)
 * - per round: at most 1 item per sender
 * - strict global dedup (a URL appears only once in the whole game)
 * - fallback: if sender has no owned item at index i, pick an unused candidate item where sender is in true_sender_keys
 * - item.k = min(k_max, true_senders_count)
 */
export function generateRoundsB(args: {
  room_code: string;
  seed: string;
  k_max: number;
  items: ItemByUrl[];
  senders: SenderRow[];
}): {
  senders_payload: SenderAll[];
  rounds: SetupRound[];
  round_order: string[];
  metrics: {
    active_senders: number;
    rounds_max: number;
    rounds_complete: number;
    items_total: number;
    urls_unique: number;
    urls_multi_sender: number;
    k_max: number;
  };
  debug: {
    unused_urls: number;
    fallback_picks: number;
  };
} {
  const seedStr = `${args.room_code}:${args.seed ?? ""}`;
  const k_max = Math.max(1, Math.min(8, Math.floor(args.k_max || 4)));

  const activeSenders = args.senders.filter((s) => s.active && s.reels_count > 0);
  const activeKeys = activeSenders.map((s) => s.sender_key);

  const senders_payload: SenderAll[] = args.senders.map((s) => ({
    sender_id: senderIdFromNameKey(s.sender_key),
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  // Build internal items (filtered to active senders only)
  const internal: ItemInternal[] = [];
  for (const it of args.items) {
    const filtered = it.true_sender_keys.filter((k) => activeKeys.includes(k));
    if (filtered.length === 0) continue;
    const sorted = filtered.slice().sort();
    const owner = sorted[0]; // deterministic owner
    internal.push({
      url: it.url,
      true_sender_keys: sorted,
      owner_key: owner,
      k_raw: sorted.length,
      multi: sorted.length > 1,
    });
  }

  // stats
  const urls_unique = internal.length;
  const urls_multi_sender = internal.filter((x) => x.multi).length;

  // queues per sender: owned items
  const ownedQueues = new Map<string, ItemInternal[]>();
  const candidatePools = new Map<string, ItemInternal[]>(); // any item where sender appears
  for (const k of activeKeys) {
    ownedQueues.set(k, []);
    candidatePools.set(k, []);
  }

  for (const it of internal) {
    if (ownedQueues.has(it.owner_key)) ownedQueues.get(it.owner_key)!.push(it);
    for (const k of it.true_sender_keys) {
      if (candidatePools.has(k)) candidatePools.get(k)!.push(it);
    }
  }

  // sort queues: multi first, then k desc, then stable shuffle tie-break
  for (const k of activeKeys) {
    const q = ownedQueues.get(k)!;
    const shuffled = stableShuffle(q, `${seedStr}:owned:${k}`);
    shuffled.sort((a, b) => {
      if (a.multi !== b.multi) return a.multi ? -1 : 1;
      if (b.k_raw !== a.k_raw) return b.k_raw - a.k_raw;
      return a.url.localeCompare(b.url);
    });
    ownedQueues.set(k, shuffled);

    const pool = candidatePools.get(k)!;
    const psh = stableShuffle(pool, `${seedStr}:pool:${k}`);
    psh.sort((a, b) => {
      if (a.multi !== b.multi) return a.multi ? -1 : 1;
      if (b.k_raw !== a.k_raw) return b.k_raw - a.k_raw;
      return a.url.localeCompare(b.url);
    });
    candidatePools.set(k, psh);
  }

  // rounds_max = reels_count of 2nd active sender (desc)
  const countsDesc = activeSenders.map((s) => s.reels_count).sort((a, b) => b - a);
  const rounds_max = countsDesc.length >= 2 ? countsDesc[1] : 0;
  const rounds_complete = countsDesc.length >= 1 ? Math.min(...countsDesc) : 0;

  const used = new Set<string>(); // url
  let fallback_picks = 0;

  const rounds: SetupRound[] = [];
  let globalItemIdx = 0;

  for (let i = 0; i < rounds_max; i++) {
    const items: SetupItem[] = [];

    for (const senderKey of activeKeys) {
      // 1) normal pick: i-th owned item
      const owned = ownedQueues.get(senderKey)!;
      let pick: ItemInternal | null = owned[i] ?? null;

      // if already used (can happen due to earlier fallback), skip to next available owned
      if (pick && used.has(pick.url)) {
        pick = null;
        for (let j = i; j < owned.length; j++) {
          if (!used.has(owned[j].url)) {
            pick = owned[j];
            break;
          }
        }
      }

      // 2) fallback: any candidate containing senderKey not used yet
      if (!pick) {
        const pool = candidatePools.get(senderKey)!;
        const found = pool.find((x) => !used.has(x.url));
        if (found) {
          pick = found;
          fallback_picks++;
        }
      }

      if (!pick) continue;

      used.add(pick.url);

      const true_sender_ids = pick.true_sender_keys.map(senderIdFromNameKey);
      const k = clampK(pick.k_raw, k_max);

      items.push({
        item_id: `item_${globalItemIdx + 1}`,
        reel: { reel_id: reelIdFromUrl(pick.url), url: pick.url },
        k,
        true_sender_ids,
      });
      globalItemIdx++;
    }

    // Sort within round: multi first, then k desc, stable shuffle tie-break
    const shuffled = stableShuffle(items, `${seedStr}:round:${i}`);
    shuffled.sort((a, b) => {
      const ma = a.true_sender_ids.length > 1;
      const mb = b.true_sender_ids.length > 1;
      if (ma !== mb) return ma ? -1 : 1;
      if (b.k !== a.k) return b.k - a.k;
      return a.reel.url.localeCompare(b.reel.url);
    });

    rounds.push({ round_id: `round_${i + 1}`, items: shuffled });
  }

  const round_order = rounds.map((r) => r.round_id);

  return {
    senders_payload,
    rounds,
    round_order,
    metrics: {
      active_senders: activeSenders.length,
      rounds_max,
      rounds_complete,
      items_total: rounds.reduce((acc, r) => acc + r.items.length, 0),
      urls_unique,
      urls_multi_sender,
      k_max,
    },
    debug: {
      unused_urls: Math.max(0, urls_unique - used.size),
      fallback_picks,
    },
  };
}
