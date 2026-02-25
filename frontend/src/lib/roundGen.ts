// frontend/src/lib/roundGen.ts

import type { SenderAll } from "@brp/contracts";
import type { ItemByUrl, SenderRow } from "./draftModel";

export type RoundGenItem = {
  item_id: string;
  reel: { reel_id: string; url: string };
  true_sender_ids: string[];
};

export type RoundGenRound = {
  round_id: string;
  items: RoundGenItem[];
};

function hash32(s: string): number {
  // FNV-1a 32-bit
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

/**
 * Option B:
 * - Multi-sender items first
 * - k = true_senders length
 * - rounds_max = reels count of 2nd active sender (sorted desc)
 * - Each round i contains at most 1 item per sender (if available at index i)
 * - Items are unique globally (each url used once)
 */
export function generateRoundsB(args: {
  room_code: string;
  seed?: string;
  items: ItemByUrl[];
  senders: SenderRow[];
}): {
  senders_payload: SenderAll[];
  rounds: RoundGenRound[];
  round_order: string[];
  metrics: {
    active_senders: number;
    rounds_max: number;
    rounds_complete: number;
    items_total: number;
    multi_sender_items: number;
  };
} {
  const seedStr = `${args.room_code}:${args.seed ?? ""}`;

  const activeSenders = args.senders.filter((s) => s.active && s.reels_count > 0);
  const activeKeys = activeSenders.map((s) => s.sender_key);

  const senders_payload: SenderAll[] = args.senders.map((s) => ({
    sender_id: senderIdFromNameKey(s.sender_key),
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  // Assign each unique item to exactly one owner sender (first sender key) to avoid duplicates.
  const ownedBy = new Map<string, string>(); // url -> owner_key
  for (const it of args.items) {
    const owner = it.true_sender_keys.slice().sort()[0];
    ownedBy.set(it.url, owner);
  }

  // Build per-sender queues of items (only items owned by that sender)
  const queues = new Map<string, ItemByUrl[]>();
  for (const k of activeKeys) queues.set(k, []);

  for (const it of args.items) {
    const owner = ownedBy.get(it.url);
    if (!owner) continue;
    if (!queues.has(owner)) continue; // owner may be inactive
    // filter true_senders to active only
    const filteredTrue = it.true_sender_keys.filter((k) => activeKeys.includes(k));
    if (filteredTrue.length === 0) continue;
    queues.get(owner)!.push({ url: it.url, true_sender_keys: filteredTrue });
  }

  // Sort queues: multi-sender first, then k desc, then stable shuffle
  for (const [k, list] of queues.entries()) {
    const shuffled = stableShuffle(list, `${seedStr}:sender:${k}`);
    shuffled.sort((a, b) => {
      const ka = a.true_sender_keys.length;
      const kb = b.true_sender_keys.length;
      if (kb !== ka) return kb - ka;
      return a.url.localeCompare(b.url);
    });
    queues.set(k, shuffled);
  }

  // rounds_max = reels_count of 2nd active sender (desc)
  const countsDesc = activeSenders.map((s) => s.reels_count).sort((a, b) => b - a);
  const rounds_max = countsDesc.length >= 2 ? countsDesc[1] : 0;
  const rounds_complete = countsDesc.length >= 1 ? Math.min(...countsDesc) : 0;

  const rounds: RoundGenRound[] = [];
  let globalItemIdx = 0;

  for (let i = 0; i < rounds_max; i++) {
    const items: RoundGenItem[] = [];

    for (const senderKey of activeKeys) {
      const q = queues.get(senderKey) ?? [];
      const pick = q[i];
      if (!pick) continue;

      const true_sender_ids = pick.true_sender_keys.map(senderIdFromNameKey);
      items.push({
        item_id: `item_${globalItemIdx + 1}`,
        reel: { reel_id: reelIdFromUrl(pick.url), url: pick.url },
        true_sender_ids,
      });
      globalItemIdx++;
    }

    // Within the round: multi-sender first, then stable shuffle
    const shuffled = stableShuffle(items, `${seedStr}:round:${i}`);
    shuffled.sort((a, b) => {
      const ka = a.true_sender_ids.length;
      const kb = b.true_sender_ids.length;
      if (kb !== ka) return kb - ka;
      return a.reel.url.localeCompare(b.reel.url);
    });

    rounds.push({ round_id: `round_${i + 1}`, items: shuffled });
  }

  const round_order = rounds.map((r) => r.round_id);
  const multi_sender_items = args.items.filter((it) => it.true_sender_keys.length > 1).length;

  return {
    senders_payload,
    rounds,
    round_order,
    metrics: {
      active_senders: activeSenders.length,
      rounds_max,
      rounds_complete,
      items_total: rounds.reduce((acc, r) => acc + r.items.length, 0),
      multi_sender_items,
    },
  };
}
