import { describe, it, expect } from "vitest";
import { generateRoundsB } from "./roundGen";
import type { ItemByUrl, SenderRow } from "./draftModel";

function mkSenders(): SenderRow[] {
  return [
    { sender_key: "alice", name: "Alice", active: true, reels_count: 10, merged_children: [] },
    { sender_key: "bob", name: "Bob", active: true, reels_count: 10, merged_children: [] },
    { sender_key: "carl", name: "Carl", active: true, reels_count: 10, merged_children: [] },
  ];
}

function mkItems(): ItemByUrl[] {
  return [
    { url: "https://instagram.com/reel/1", true_sender_keys: ["alice"] },
    { url: "https://instagram.com/reel/2", true_sender_keys: ["bob"] },
    { url: "https://instagram.com/reel/3", true_sender_keys: ["carl"] },
    { url: "https://instagram.com/reel/4", true_sender_keys: ["alice", "bob"] },
    { url: "https://instagram.com/reel/5", true_sender_keys: ["alice", "carl"] },
    { url: "https://instagram.com/reel/6", true_sender_keys: ["bob", "carl"] },
  ];
}

describe("roundGen.generateRoundsB", () => {
  it("is deterministic for the same seed + room_code", () => {
    const args = {
      room_code: "AAAAAA",
      seed: "seed123",
      k_max: 4,
      items: mkItems(),
      senders: mkSenders(),
    };

    const a = generateRoundsB(args);
    const b = generateRoundsB(args);

    expect(JSON.stringify(a.rounds)).toBe(JSON.stringify(b.rounds));
    expect(JSON.stringify(a.round_order)).toBe(JSON.stringify(b.round_order));
    expect(JSON.stringify(a.senders_payload)).toBe(JSON.stringify(b.senders_payload));
  });

  it("enforces: max 1 multi item per round", () => {
    const out = generateRoundsB({
      room_code: "BBBBBB",
      seed: "seed_multi",
      k_max: 4,
      items: mkItems(),
      senders: mkSenders(),
    });

    for (const r of out.rounds) {
      const multiCount = r.items.filter((it) => it.true_sender_ids.length >= 2).length;
      expect(multiCount).toBeLessThanOrEqual(1);
    }
  });

  it("enforces: no sender appears twice in the same round", () => {
    const out = generateRoundsB({
      room_code: "CCCCCC",
      seed: "seed_norepeat",
      k_max: 4,
      items: mkItems(),
      senders: mkSenders(),
    });

    for (const r of out.rounds) {
      const seen = new Set<string>();
      for (const it of r.items) {
        for (const sid of it.true_sender_ids) {
          expect(seen.has(sid)).toBe(false);
          seen.add(sid);
        }
      }
    }
  });

  it("enforces: k <= true_sender_ids.length", () => {
    const out = generateRoundsB({
      room_code: "DDDDDD",
      seed: "seed_k",
      k_max: 8,
      items: mkItems(),
      senders: mkSenders(),
    });

    for (const r of out.rounds) {
      for (const it of r.items) {
        expect(it.k).toBeGreaterThanOrEqual(1);
        expect(it.k).toBeLessThanOrEqual(it.true_sender_ids.length);
      }
    }
  });

  it("does not reuse the same URL across all rounds", () => {
    const out = generateRoundsB({
      room_code: "EEEEEE",
      seed: "seed_urls",
      k_max: 4,
      items: mkItems(),
      senders: mkSenders(),
    });

    const seen = new Set<string>();
    for (const r of out.rounds) {
      for (const it of r.items) {
        expect(seen.has(it.reel.url)).toBe(false);
        seen.add(it.reel.url);
      }
    }
  });
});
