import type { SenderAll } from "@brp/contracts";
import type { ItemByUrl, SenderRow } from "./draftModel";

/**
 * Round generation — Spec v3
 *
 * Règles:
 * - URL global dedupe (ItemByUrl = 1 URL unique avec 1..N true_sender_keys)
 * - Senders actifs uniquement (inactive exclus)
 * - Génération round par round, séquentielle
 * - Dans un round: un sender ne peut apparaître qu'une fois (subset strict)
 * - Max 1 item multi-sender (2+ senders) par round. Dès qu'un multi est pris => mono-only
 * - remaining_count_by_sender (mono + multi) :
 *   si un sender n'a plus d'items restants, on le retire de remaining_to_fill
 * - Déterministe à seed égale
 * - Ordre de pool: shuffle déterministe puis buckets: (2+ senders) puis (1 sender)
 * - Tri intra-round: décroissant par nb de senders
 */

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

function senderIdFromKey(k: string): string {
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
  true_sender_keys: string[]; // active root keys only, sorted
  k_raw: number;
  multi: boolean;
};

function clampK(k_raw: number, k_max: number): number {
  const k = Math.max(1, k_raw);
  return Math.min(k, Math.max(1, k_max));
}

function isSubsetKeys(keys: string[], remainingToFill: Set<string>): boolean {
  for (const k of keys) if (!remainingToFill.has(k)) return false;
  return true;
}

function pruneZeroRemaining(
  remainingToFill: Set<string>,
  remainingCount: Record<string, number>
): number {
  let dropped = 0;
  for (const k of Array.from(remainingToFill)) {
    if ((remainingCount[k] ?? 0) <= 0) {
      remainingToFill.delete(k);
      dropped += 1;
    }
  }
  return dropped;
}

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

    // NEW (Spec v3)
    items_multi: number;
    items_mono: number;
    rounds_generated: number;
    items_used: number;
    senders_dropped_total: number;
  };
  debug: {
    unused_urls: number;
    fallback_picks: number;
  };
} {
  const seedStr = `${args.room_code}:${args.seed ?? ""}`;
  const k_max = Math.max(1, Math.min(8, Math.floor(args.k_max || 4)));

  // payload: keep all senders (active/inactive) for backend visibility
  const senders_payload: SenderAll[] = args.senders.map((s) => ({
    sender_id: senderIdFromKey(s.sender_key),
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  // active roots only
  const activeSenders = args.senders.filter((s) => s.active && s.reels_count > 0);
  const activeKeys = activeSenders.map((s) => s.sender_key);
  const activeKeySet = new Set(activeKeys);

  // internal pool filtered to active senders
  const internal: ItemInternal[] = [];
  for (const it of args.items) {
    const filtered = it.true_sender_keys.filter((k) => activeKeySet.has(k));
    if (filtered.length === 0) continue;

    // DEFENSE: an URL cannot have the same sender twice
    const uniq = Array.from(new Set(filtered)).sort();

    internal.push({
      url: it.url,
      true_sender_keys: uniq,
      k_raw: uniq.length,
      multi: uniq.length >= 2,
    });
  }

  const urls_unique = internal.length;
  const urls_multi_sender = internal.filter((x) => x.multi).length;

  // shuffle deterministically then bucket (2+ then 1)
  const shuffled = stableShuffle(internal, `${seedStr}:pool`);
  const multiBucket: ItemInternal[] = [];
  const monoBucket: ItemInternal[] = [];
  for (const it of shuffled) {
    if (it.multi) multiBucket.push(it);
    else monoBucket.push(it);
  }
  const poolIter = multiBucket.concat(monoBucket);

  const items_multi = multiBucket.length;
  const items_mono = monoBucket.length;

  // remaining_count_by_sender (mono + multi), on non-used items
  const remainingCount: Record<string, number> = {};
  for (const k of activeKeys) remainingCount[k] = 0;
  for (const it of poolIter) {
    for (const k of it.true_sender_keys) {
      remainingCount[k] = (remainingCount[k] ?? 0) + 1;
    }
  }

  const usedUrls = new Set<string>(); // global URL used
  const rounds: SetupRound[] = [];
  let sendersDroppedTotal = 0;
  let itemsUsedTotal = 0;
  let globalItemIdx = 0;

  while (true) {
    const remainingToFill = new Set<string>(activeKeys);
    sendersDroppedTotal += pruneZeroRemaining(remainingToFill, remainingCount);

    // stop global if no sender left to fill at start
    if (remainingToFill.size === 0) break;

    const picked: ItemInternal[] = [];
    let roundHasMulti = false;

    for (const it of poolIter) {
      if (usedUrls.has(it.url)) continue;

      // after first multi -> mono only
      if (roundHasMulti && it.multi) continue;

      if (!isSubsetKeys(it.true_sender_keys, remainingToFill)) continue;

      // pick it
      usedUrls.add(it.url);
      itemsUsedTotal += 1;
      picked.push(it);

      for (const k of it.true_sender_keys) {
        if (remainingToFill.has(k)) remainingToFill.delete(k);
      }

      if (it.multi) roundHasMulti = true;

      // complete round
      if (remainingToFill.size === 0) break;
    }

    // If we couldn't fill all senders, stop (round incomplete)
    if (remainingToFill.size !== 0) break;

    // Apply remaining_count updates
    for (const it of picked) {
      for (const k of it.true_sender_keys) remainingCount[k] = (remainingCount[k] ?? 0) - 1;
    }

    const round_id = `rd_${rounds.length + 1}`;
    const items: SetupItem[] = picked.map((it) => {
      globalItemIdx += 1;
      const true_sender_ids = it.true_sender_keys.map(senderIdFromKey);
      const k = clampK(it.k_raw, k_max);
      return {
        item_id: `it_${globalItemIdx}`,
        reel: { reel_id: reelIdFromUrl(it.url), url: it.url },
        k,
        true_sender_ids,
      };
    });

    rounds.push({ round_id, items });
  }

  const round_order = rounds.map((r) => r.round_id);

  const rounds_complete = rounds.length;
  const rounds_max = rounds_complete; // with this generator, generated rounds are complete

  const used = new Set<string>();
  for (const r of rounds) for (const it of r.items) used.add(it.reel.url);

  const unused_urls = urls_unique - used.size;

  // debug: fallback_picks unused in this impl, keep stable field
  const fallback_picks = 0;

  return {
    senders_payload,
    rounds,
    round_order,
    metrics: {
      active_senders: activeSenders.length,
      rounds_max,
      rounds_complete,
      items_total: urls_unique,
      urls_unique,
      urls_multi_sender,
      k_max,

      items_multi,
      items_mono,
      rounds_generated: rounds.length,
      items_used: itemsUsedTotal,
      senders_dropped_total: sendersDroppedTotal,
    },
    debug: {
      unused_urls,
      fallback_picks,
    },
  };
}
