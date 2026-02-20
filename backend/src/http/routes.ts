import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLobby } from "../state/lobbyStore";

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

  // Photo upload endpoints will be added later:
  // POST /lobby/:joinCode/players/:playerId/photo
}
