import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLobby, deleteLobby, getLobby } from "../state/lobbyStore";
import { closeLobbyWs } from "../ws/lobbyWs";

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

  // NEW: close/purge lobby (reset)
  app.post("/lobby/:joinCode/close", async (req, reply) => {
    const join_code = String((req.params as any).joinCode || "");
    const bodySchema = z.object({
      master_key: z.string(),
      reason: z.enum(["reset", "start_game", "unknown"]).optional()
    });
    const parsed = bodySchema.safeParse((req as any).body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "BAD_REQUEST" });
    }

    const state = await getLobby(join_code);
    if (!state) return reply.code(404).send({ ok: false, error: "LOBBY_NOT_FOUND" });
    if (parsed.data.master_key !== state.master_key) return reply.code(403).send({ ok: false, error: "MASTER_KEY_INVALID" });

    const reason = parsed.data.reason || "unknown";

    // Broadcast WS + close sockets, then delete redis state
    closeLobbyWs(join_code, reason);
    await deleteLobby(join_code);

    return reply.send({ ok: true });
  });

  // Photo upload endpoints will be added later:
  // POST /lobby/:joinCode/players/:playerId/photo
}
