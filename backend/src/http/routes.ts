import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLobby, deleteLobby, getLobby } from "../state/lobbyStore";
import { forceCloseLobbySockets } from "../ws/lobbyWs";

export async function registerHttpRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  // Front expects: POST /lobby/open -> {join_code, master_key}
  app.post("/lobby/open", async (req, reply) => {
    const bodySchema = z.object({
      local_room_id: z.string().optional()
    });
    const body = bodySchema.safeParse((req as any).body ?? {});
    const local_room_id = body.success && body.data.local_room_id ? body.data.local_room_id : `local_${Date.now()}`;

    const out = await createLobby(local_room_id);
    return reply.send(out);
  });

  // Close/purge lobby (reset)
  app.post("/lobby/:joinCode/close", async (req, reply) => {
    const join_code = String((req.params as any).joinCode || "");
    const bodySchema = z.object({
      master_key: z.string()
    });
    const body = bodySchema.safeParse((req as any).body ?? {});
    if (!body.success) return reply.status(400).send({ error: "BAD_REQUEST" });

    const state = await getLobby(join_code);
    if (!state) return reply.status(404).send({ error: "LOBBY_NOT_FOUND" });

    if (body.data.master_key !== state.master_key) {
      return reply.status(403).send({ error: "MASTER_KEY_INVALID" });
    }

    // 1) broadcast lobby_closed + close sockets
    forceCloseLobbySockets(join_code, "reset", "Room réinitialisée");

    // 2) delete redis state (purge lobby)
    await deleteLobby(join_code);

    return reply.send({ ok: true });
  });

  // Photo upload endpoints will be added later:
  // POST /lobby/:joinCode/players/:playerId/photo
}
