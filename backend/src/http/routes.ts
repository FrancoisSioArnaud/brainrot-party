// backend/src/http/routes.ts
import type { FastifyInstance } from "fastify";
import { buildNewRoom } from "../state/createRoom.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { sha256Hex } from "../utils/hash.js";
import type { SenderAll } from "@brp/contracts";

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
    seed?: string;
    senders: SenderAll[];
    rounds: unknown[];
    round_order: string[];
  };

  app.post<{
    Params: { code: string };
    Body: RoomSetupBody;
    Headers: { "x-master-key"?: string };
  }>("/room/:code/setup", async (req, reply) => {
    const code = (req.params.code ?? "").toUpperCase();
    const masterKey = req.headers["x-master-key"];

    if (!code || code.length < 4) {
      return reply.code(400).send({ error: "validation_error", message: "Invalid room code" });
    }
    if (!masterKey) {
      return reply.code(401).send({ error: "invalid_master_key", message: "Missing x-master-key header" });
    }

    const meta = await repo.getMeta(code);
    if (!meta) {
      return reply.code(410).send({ error: "room_expired", message: "Room expired" });
    }

    if (sha256Hex(masterKey) !== meta.master_hash) {
      return reply.code(401).send({ error: "invalid_master_key", message: "Invalid master key" });
    }

    const body = req.body;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "validation_error", message: "Missing body" });
    }

    if (
      typeof body.protocol_version !== "number" ||
      !Array.isArray(body.senders) ||
      !Array.isArray(body.rounds) ||
      !Array.isArray(body.round_order)
    ) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid payload shape",
        details: {
          required: ["protocol_version:number", "senders:array", "rounds:array", "round_order:array"],
        },
      });
    }

    const state = await repo.getState<any>(code);
    if (!state) {
      return reply.code(410).send({ error: "room_expired", message: "Room expired" });
    }

    // Hydrate senders for lobby display, and store setup payload for later game.
    state.senders = body.senders;
    state.setup = {
      protocol_version: body.protocol_version,
      seed: body.seed,
      rounds: body.rounds,
      round_order: body.round_order,
    };

    await repo.setState(code, state);
    await repo.touchRoomAll(code);
    return { status: "ok" };
  });
}
