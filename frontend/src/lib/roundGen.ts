import type { SenderAll } from "@brp/contracts";
import type { ItemByUrl, SenderRow } from "./draftModel";

/**
 * Round generation — Spec v3 (aligné avec ton projet actuel)
 *
 * Règles implémentées :
 * - Global URL dedupe : ItemByUrl = 1 URL unique avec 1..N true_sender_keys.
 * - Génération sur senders actifs uniquement (inactive exclus de la pool/rounds).
 * - Rounds construits séquentiellement jusqu'à impossibilité de démarrer un nouveau round.
 * - Dans un round : un sender ne peut apparaître qu'une seule fois (subset strict).
 * - Max 1 item multi-sender (2+ senders) par round. Dès qu'un multi est pris => mono-only.
 * - Concept "remaining_count_by_sender" (mono + multi) : si un sender n'a plus d'items restants,
 *   on le retire de remaining_to_fill (les rounds peuvent rétrécir).
 * - Déterministe à seed égale.
 * - Ordre de pool : shuffle déterministe puis buckets : (2+ senders) puis (1 sender).
 * - Tri intra-round : décroissant par nb de senders (multi d'abord).
 *
 * NOTE compat : on conserve le nom export generateRoundsB et la forme de retour.
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
  k_raw: number; // true_sender_keys.length
  multi: boolean; // k_raw >= 2
};

function clampK(k_raw: number, k_max: number): number {
  const k = Math.max(1, k_raw);
  return Math.min(k, Math.max(1, k_max));
}

function isSubsetKeys(a: string[], bSet: Set<string>): boolean {
  for (const x of a) if (!bSet.has(x)) return false;
  return true;
}

/**
 * Retire de remaining_to_fill les senders dont remainingCount==0.
 * Retourne combien ont été retirés (métrique).
 */
function pruneZeroRemaining(
  remainingToFill: Set<string>,
  remainingCount: Record<string, number>
): number {
  let dropped = 0;
  for (const k of Array.from(remainingToFill)) {
    if ((remainingCount[k] ?? 0) <= 0) {
      remainingToFill.delete(k);
      dropped++;
    }
  }
  return dropped;
}

/**
 * generateRoundsB (mis à jour Spec v3)
 *
 * Conserve la même signature + shape de retour pour éviter de casser Setup.tsx.
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

  // Active senders (roots) uniquement
  const activeSenders = args.senders.filter((s) => s.active && s.reels_count > 0);
  const activeKeys = activeSenders.map((s) => s.sender_key);
  const activeKeySet = new Set(activeKeys);

  // Payload : on conserve tous les senders comme avant (actifs + inactifs)
  const senders_payload: SenderAll[] = args.senders.map((s) => ({
    sender_id: senderIdFromNameKey(s.sender_key),
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  // Pool interne : items filtrés aux senders actifs uniquement
  const internal: ItemInternal[] = [];
  for (const it of args.items) {
    const filtered = it.true_sender_keys.filter((k) => activeKeySet.has(k));
    if (filtered.length === 0) continue;
    const sorted = filtered.slice().sort();
    internal.push({
      url: it.url,
      true_sender_keys: sorted,
      k_raw: sorted.length,
      multi: sorted.length >= 2,
    });
  }

  const urls_unique = internal.length;
  const urls_multi_sender = internal.filter((x) => x.multi).length;

  // Random déterministe, puis buckets : 2+ puis 1
  const shuffled = stableShuffle(internal, `${seedStr}:pool`);
  const multiBucket: ItemInternal[] = [];
  const monoBucket: ItemInternal[] = [];
  for (const it of shuffled) {
    if (it.multi) multiBucket.push(it);
    else monoBucket.push(it);
  }
  const poolIter = multiBucket.concat(monoBucket);

  // remaining_count_by_sender : count des items NON-USED où le sender apparaît (mono + multi)
  const remainingCount: Record<string, number> = {};
  for (const k of activeKeys) remainingCount[k] = 0;
  for (const it of poolIter) {
    for (const k of it.true_sender_keys) {
      if (activeKeySet.has(k)) remainingCount[k] = (remainingCount[k] ?? 0) + 1;
    }
  }

  const used = new Set<string>(); // url global
  const rounds: SetupRound[] = [];
  let globalItemIdx = 0;
  let sendersDroppedTotal = 0;

  while (true) {
    // Init round : tous les senders actifs, puis on retire ceux à 0 restant
    const remainingToFill = new Set<string>(activeKeys);
    sendersDroppedTotal += pruneZeroRemaining(remainingToFill, remainingCount);

    // Stop global si plus aucun sender à chercher au début du round
    if (remainingToFill.size === 0) break;

    const picked: ItemInternal[] = [];
    let roundHasMulti = false;

    // Scan pool
    for (const it of poolIter) {
      if (used.has(it.url)) continue;

      // Après le premier multi du round => mono-only
      if (roundHasMulti && it.multi) continue;

      // Fit : tous ses senders doivent être encore à remplir
      if (!isSubsetKeys(it.true_sender_keys, remainingToFill)) continue;

      // Pick
      used.add(it.url);
      picked.push(it);

      // Consommer les senders + décrémenter remainingCount
      for (const k of it.true_sender_keys) {
        if (remainingToFill.has(k)) remainingToFill.delete(k);
        remainingCount[k] = (remainingCount[k] ?? 0) - 1;
      }

      if (it.multi) roundHasMulti = true;

      // Après chaque pick : retirer les senders devenus impossibles
      sendersDroppedTotal += pruneZeroRemaining(remainingToFill, remainingCount);

      if (remainingToFill.size === 0) break;
    }

    // Si round vide => stop global
    if (picked.length === 0) break;

    // Tri intra-round : nb senders décroissant
    picked.sort((a, b) => {
      const d = b.true_sender_keys.length - a.true_sender_keys.length;
      if (d !== 0) return d;
      return a.url.localeCompare(b.url);
    });

    const items: SetupItem[] = [];
    for (const it of picked) {
      const true_sender_ids = it.true_sender_keys.map(senderIdFromNameKey);
      const k = clampK(it.k_raw, k_max);

      items.push({
        item_id: `item_${globalItemIdx + 1}`,
        reel: { reel_id: reelIdFromUrl(it.url), url: it.url },
        k,
        true_sender_ids,
      });
      globalItemIdx++;
    }

    rounds.push({ round_id: `round_${rounds.length + 1}`, items });
  }

  const round_order = rounds.map((r) => r.round_id);

  return {
    senders_payload,
    rounds,
    round_order,
    metrics: {
      active_senders: activeSenders.length,
      // Spec v3 : génération "jusqu'à épuisement" — on conserve les champs pour l'UI
      rounds_max: rounds.length,
      rounds_complete: rounds.length,
      items_total: rounds.reduce((acc, r) => acc + r.items.length, 0),
      urls_unique,
      urls_multi_sender,
      k_max,
    },
    debug: {
      unused_urls: Math.max(0, urls_unique - used.size),
      fallback_picks: 0,
    },
  };
}
