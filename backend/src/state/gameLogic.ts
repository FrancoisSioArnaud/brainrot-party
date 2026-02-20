import { GameState, ReelItem, RoundItem } from "./gameStore";

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

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build rounds at Start game (Spec Option A):
 * - remaining_urls(sender) = all reel_items where sender in sender_ids and not consumed
 * - each round: each sender draws 1 url from remaining (seeded)
 * - group by url => round items
 * - truth slots = reel_item.sender_ids (actifs only) => multi-slot guess
 * - consumption is global: when reel chosen, consumed for all senders in reel_item.sender_ids
 * - order: multi-senders first, k desc, then random seeded
 * - end: <= 1 sender has remaining
 */
export function buildRoundsFromReels(seed: number, activeSenderIds: string[], reelItems: ReelItem[]) {
  const rng = mulberry32(seed);

  const bySender: Record<string, ReelItem[]> = {};
  for (const sid of activeSenderIds) bySender[sid] = [];

  for (const it of reelItems) {
    for (const sid of it.sender_ids) {
      if (bySender[sid]) bySender[sid].push(it);
    }
  }

  // sender queues (seeded shuffle)
  const queues: Record<string, string[]> = {};
  for (const sid of activeSenderIds) {
    const urls = bySender[sid].map(r => r.id);
    queues[sid] = shuffle(rng, urls);
  }

  const reelById = new Map<string, ReelItem>();
  for (const r of reelItems) reelById.set(r.id, r);

  const consumed = new Set<string>();

  function senderHasRemaining(sid: string) {
    const q = queues[sid] || [];
    for (const rid of q) if (!consumed.has(rid)) return true;
    return false;
  }

  function nextForSender(sid: string): string | null {
    const q = queues[sid] || [];
    // pop from front until find not consumed
    while (q.length > 0) {
      const rid = q[0];
      if (!consumed.has(rid)) return rid;
      q.shift();
    }
    return null;
  }

  const rounds: { index: number; items: RoundItem[] }[] = [];
  let roundIndex = 0;

  // guard against infinite loop (bad data)
  for (let safety = 0; safety < 10000; safety++) {
    const sendersWithRemaining = activeSenderIds.filter(senderHasRemaining);
    if (sendersWithRemaining.length <= 1) break;

    // Each sender draws 1 reel_id
    const drawn: string[] = [];
    for (const sid of sendersWithRemaining) {
      const rid = nextForSender(sid);
      if (rid) drawn.push(rid);
    }

    // group by reel_id
    const uniq = Array.from(new Set(drawn));

    // consume for all sender_ids of each reel
    for (const rid of uniq) {
      const reel = reelById.get(rid);
      if (!reel) continue;
      consumed.add(rid);
    }

    // create round items
    let items: RoundItem[] = uniq
      .map((rid, idx) => {
        const reel = reelById.get(rid);
        const truth = reel ? reel.sender_ids.slice() : [];
        const k = truth.length || 1;
        return {
          id: `ri_${roundIndex}_${idx}_${crypto.randomUUID()}`,
          reel_item_id: rid,
          k,
          truth_sender_ids: truth,
          opened: false,
          resolved: false,
          order_index: idx
        };
      });

    // order: multi-senders first (k>1), k desc, then seeded random
    const multi = items.filter(i => i.k > 1);
    const single = items.filter(i => i.k <= 1);
    multi.sort((a, b) => b.k - a.k);
    single.sort((a, b) => b.k - a.k);

    const rest = shuffle(rng, [...multi, ...single]).map((it, i) => ({ ...it, order_index: i }));
    items = rest;

    rounds.push({ index: roundIndex, items });
    roundIndex += 1;
  }

  return rounds;
}

export function getCurrentRound(state: GameState) {
  return state.rounds[state.current_round_index] || null;
}

export function getCurrentItem(state: GameState) {
  const r = getCurrentRound(state);
  if (!r) return null;
  return r.items[state.current_item_index] || null;
}

export function remainingSendersForRound(state: GameState): string[] {
  const r = getCurrentRound(state);
  if (!r) return [];
  const all = new Set<string>();
  const done = new Set<string>();

  for (const it of r.items) {
    for (const s of it.truth_sender_ids) all.add(s);
    if (it.resolved) for (const s of it.truth_sender_ids) done.add(s);
  }
  return [...all].filter((x) => !done.has(x));
}

export function allActivePlayersVoted(state: GameState, item_id: string): boolean {
  const activePlayers = state.players.filter((p) => p.active);
  const votesForItem = state.votes[item_id] || {};
  return activePlayers.every((p) => Array.isArray(votesForItem[p.id]));
}

export function scoreForPlayerSelection(truth: string[], selected: string[]) {
  const t = new Set(truth);
  let pts = 0;
  for (const s of selected) if (t.has(s)) pts += 1;
  return pts;
}

export function computeCorrectness(truth: string[], selected: string[]) {
  const t = new Set(truth);
  const out: Record<string, boolean> = {};
  for (const s of selected) out[s] = t.has(s);
  return out;
}
