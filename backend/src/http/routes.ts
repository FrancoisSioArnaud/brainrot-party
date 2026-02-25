import type { FastifyInstance } from "fastify";
import { buildNewRoom } from "../state/createRoom.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { sha256Hex } from "../utils/hash.js";
import type { SenderAll } from "@brp/contracts";
import type { RoomStateInternal, SetupRound, SetupItem } from "../state/createRoom.js";

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function bad(reply: any, code: number, error: string, message: string, details?: any) {
  return reply.code(code).send({ error, message, details });
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}
function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function validateSenders(senders: any[]): { ok: boolean; err?: any } {
  const ids = new Set<string>();
  for (const s of senders) {
    if (!isObject(s)) return { ok: false, err: "sender_not_object" };
    if (!isString(s.sender_id) || !s.sender_id) return { ok: false, err: "sender_id_invalid" };
    if (!isString(s.name)) return { ok: false, err: "sender_name_invalid" };
    if (typeof s.active !== "boolean") return { ok: false, err: "sender_active_invalid" };
    if (!isNumber(s.reels_count) || s.reels_count < 0) return { ok: false, err: "sender_reels_count_invalid" };
    if (ids.has(s.sender_id)) return { ok: false, err: "sender_id_duplicate" };
    ids.add(s.sender_id);
  }
  return { ok: true };
}

function validateRounds(rounds: any[], senderIds: Set<string>): { ok: boolean; err?: any } {
  const roundIds = new Set<string>();
  const itemIds = new Set<string>();
  const urls = new Set<string>();

  for (const r of rounds) {
    if (!isObject(r)) return { ok: false, err: "round_not_object" };
    if (!isString(r.round_id) || !r.round_id) return { ok: false, err: "round_id_invalid" };
    if (roundIds.has(r.round_id)) return { ok: false, err: "round_id_duplicate" };
    roundIds.add(r.round_id);

    if (!Array.isArray((r as any).items)) return { ok: false, err: "round_items_invalid" };
    for (const it of (r as any).items) {
      if (!isObject(it)) return { ok: false, err: "item_not_object" };
      if (!isString(it.item_id) || !it.item_id) return { ok: false, err: "item_id_invalid" };
      if (itemIds.has(it.item_id)) return { ok: false, err: "item_id_duplicate" };
      itemIds.add(it.item_id);

      if (!isObject((it as any).reel)) return { ok: false, err: "item_reel_invalid" };
      const reel = (it as any).reel;
      if (!isString(reel.reel_id) || !reel.reel_id) return { ok: false, err: "reel_id_invalid" };
      if (!isString(reel.url) || !reel.url) return { ok: false, err: "reel_url_invalid" };

      // strict URL dedup
      if (urls.has(reel.url)) return { ok: false, err: "reel_url_duplicate" };
      urls.add(reel.url);

      if (!isNumber((it as any).k) || (it as any).k < 1 || (it as any).k > 8) return { ok: false, err: "k_invalid" };

      if (!Array.isArray((it as any).true_sender_ids) || (it as any).true_sender_ids.length < 1) {
        return { ok: false, err: "true_sender_ids_invalid" };
      }
      const ts = (it as any).true_sender_ids as any[];
      for (const sid of ts) {
        if (!isString(sid) || !senderIds.has(sid)) return { ok: false, err: "true_sender_not_in_senders" };
      }
      if ((it as any).k > ts.length) return { ok: false, err: "k_gt_true_senders" };
    }
  }
  return { ok: true };
}

export async function registerHttpRoutes(app: FastifyInstance, repo: RoomRepo) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/room", async (_req, reply) => {
    for (let i = 0; i < 10; i++) {
      const { code, masterKey, meta, state } = buildNewRoom();
      const existing = await repo.getMeta(code);
      if (existing) continue;

      await repo.setRoom(code, meta, state);
      return { room_code: code, master_key: masterKey };
    }

    return reply.code(500).send({ error: "internal_error", message: "Failed to allocate room code" });
  });

  type RoomSetupBody = {
    protocol_version: number;
    seed: string;
    k_max: number;
    senders: SenderAll[];
    rounds: SetupRound[];
    round_order: string[];
    metrics: Record<string, unknown>;
  };

  app.post<{
    Params: { code: string };
    Body: RoomSetupBody;
    Headers: { "x-master-key"?: string };
  }>("/room/:code/setup", async (req, reply) => {
    const code = (req.params.code ?? "").toUpperCase();
    const masterKey = req.headers["x-master-key"];

    if (!code || code.length < 4) return bad(reply, 400, "validation_error", "Invalid room code");
    if (!masterKey) return bad(reply, 401, "invalid_master_key", "Missing x-master-key header");

    const meta = await repo.getMeta(code);
    if (!meta) return bad(reply, 410, "room_expired", "Room expired");

    if (sha256Hex(masterKey) !== meta.master_hash) {
      return bad(reply, 401, "invalid_master_key", "Invalid master key");
    }

    const body = req.body;
    if (!body || typeof body !== "object") return bad(reply, 400, "validation_error", "Missing body");

    if (
      typeof body.protocol_version !== "number" ||
      !isString(body.seed) ||
      typeof body.k_max !== "number" ||
      !Array.isArray(body.senders) ||
      !Array.isArray(body.rounds) ||
      !Array.isArray(body.round_order) ||
      !isObject(body.metrics)
    ) {
      return bad(reply, 400, "validation_error", "Invalid payload shape", {
        required: [
          "protocol_version:number",
          "seed:string",
          "k_max:number",
          "senders:SenderAll[]",
          "rounds:SetupRound[]",
          "round_order:string[]",
          "metrics:object",
        ],
      });
    }

    const state = await repo.getState<RoomStateInternal>(code);
    if (!state) return bad(reply, 410, "room_expired", "Room expired");

    // Validate senders
    const vs = validateSenders(body.senders as any[]);
    if (!vs.ok) return bad(reply, 400, "validation_error", "Invalid senders", { reason: vs.err });

    const senderIds = new Set<string>((body.senders as any[]).map((s) => s.sender_id));

    // Validate rounds + strict dedup URL + k <= true_senders
    const vr = validateRounds(body.rounds as any[], senderIds);
    if (!vr.ok) return bad(reply, 400, "validation_error", "Invalid rounds", { reason: vr.err });

    // Validate round_order covers all rounds
    const roundIds = new Set<string>((body.rounds as any[]).map((r) => r.round_id));
    for (const rid of body.round_order) {
      if (!roundIds.has(rid)) return bad(reply, 400, "validation_error", "round_order references unknown round_id");
    }
    if (body.round_order.length !== roundIds.size) {
      return bad(reply, 400, "validation_error", "round_order must cover all rounds exactly once");
    }

    // Store for lobby display + later game loop
    state.senders = body.senders;

    state.setup = {
      protocol_version: body.protocol_version,
      seed: body.seed,
      k_max: body.k_max,
      rounds: body.rounds,
      round_order: body.round_order,
      metrics: body.metrics,
    };

    await repo.setState(code, state);
    await repo.touchRoomAll(code);

    return { status: "ok" };
  });
}
