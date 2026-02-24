import type { FastifyInstance } from "fastify";
import { buildNewRoom } from "../state/createRoom.js";
import type { RoomRepo } from "../state/roomRepo.js";

export async function registerHttpRoutes(app: FastifyInstance, repo: RoomRepo) {
  app.get("/health", async () => ({ ok: true }));

  // MVP: no body yet (setup comes later)
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
}
