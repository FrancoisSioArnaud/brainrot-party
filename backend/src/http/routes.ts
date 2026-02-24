import type { FastifyInstance } from "fastify";
import { buildNewRoom } from "../state/createRoom.js";
import type { RoomRepo } from "../state/roomRepo.js";

export async function registerHttpRoutes(app: FastifyInstance, repo: RoomRepo) {
  app.get("/health", async () => ({ ok: true }));

  // MVP: no body yet (setup comes later)
  app.post("/room", async (_req, _reply) => {
    // naive collision retry
    for (let i = 0; i < 10; i++) {
      const { code, masterKey, meta, state } = buildNewRoom();
      const existing = await repo.getMeta(code);
      if (existing) continue;
      await repo.setRoom(code, meta, state);
      return { room_code: code, master_key: masterKey };
    }
    return app.httpErrors.internalServerError("Failed to allocate room code");
  });
}
