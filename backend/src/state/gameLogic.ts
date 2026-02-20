import { GameState, RoundItem, Sender } from "./gameStore";

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

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
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
 * MVP placeholder:
 * - 1 round
 * - items = senders actifs (k=1)
 * - reel_item_id = "placeholder_<sender>"
 * - order random seedé
 */
export function buildInitialRounds(seed: number, senders: Sender[]) {
  const rng = mulberry32(seed);
  const active = senders.filter((s) => s.active);
  const base: RoundItem[] = active.map((s, i) => ({
    id: `ri_${i}_${crypto.randomUUID()}`,
    reel_item_id: `placeholder_${s.id_local}`,
    k: 1,
    truth_sender_ids: [s.id_local],
    opened: false,
    resolved: false,
    order_index: i,
  }));
  const shuffled = shuffle(rng, base).map((it, idx) => ({ ...it, order_index: idx }));
  return [{ index: 0, items: shuffled }];
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
