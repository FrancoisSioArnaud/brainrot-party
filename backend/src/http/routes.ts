import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

import { createLobby, deleteLobby, getLobby, saveLobby } from "../state/lobbyStore";
import { closeLobbyWs, broadcastLobbyStateNow } from "../ws/lobbyWs";

const TEMP_DIR = path.resolve(process.env.BRP_TEMP_DIR || "/tmp/brp");

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function safeJoinCode(x: string) {
  return x.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
}

export async function registerHttpRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/lobby/open", async (req, reply) => {
    const bodySchema = z.object({
      local_room_id: z.string().optional(),
    });
    const body = bodySchema.safeParse((req as any).body ?? {});
    const local_room_id =
      body.success && body.data.local_room_id ? body.data.local_room_id : `local_${Date.now()}`;

    const out = await createLobby(local_room_id);
    return reply.send(out);
  });

  app.post("/lobby/:joinCode/close", async (req, reply) => {
    const join_code = safeJoinCode(String((req.params as any).joinCode || ""));
    const bodySchema = z.object({
      master_key: z.string(),
      reason: z.enum(["reset", "start_game", "unknown"]).optional(),
    });
    const parsed = bodySchema.safeParse((req as any).body ?? {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "BAD_REQUEST" });

    const state = await getLobby(join_code);
    if (!state) return reply.code(404).send({ ok: false, error: "LOBBY_NOT_FOUND" });
    if (parsed.data.master_key !== state.master_key) {
      return reply.code(403).send({ ok: false, error: "MASTER_KEY_INVALID" });
    }

    const reason = parsed.data.reason || "unknown";

    // room_code is only known on real start_game flow; this close endpoint is mainly for reset.
    closeLobbyWs(join_code, reason);
    await deleteLobby(join_code);

    return reply.send({ ok: true });
  });

  /**
   * Upload photo (Play)
   * POST /lobby/:joinCode/players/:playerId/photo
   * multipart field: photo
   * headers:
   *  x-device-id
   *  x-player-token
   */
  app.post("/lobby/:joinCode/players/:playerId/photo", async (req, reply) => {
    const join_code = safeJoinCode(String((req.params as any).joinCode || ""));
    const player_id = String((req.params as any).playerId || "");

    const device_id = String(req.headers["x-device-id"] || "").trim();
    const player_token = String(req.headers["x-player-token"] || "").trim();

    if (!device_id || !player_token) {
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }

    const lobby = await getLobby(join_code);
    if (!lobby) return reply.code(404).send({ ok: false, error: "LOBBY_NOT_FOUND" });

    const p = lobby.players.find((x) => x.id === player_id);
    if (!p) return reply.code(404).send({ ok: false, error: "PLAYER_NOT_FOUND" });

    // ✅ reject if disabled/inactive
    if (!p.active || p.status === "disabled") {
      return reply.code(403).send({ ok: false, error: "PLAYER_DISABLED" });
    }

    // ✅ auth
    if (p.device_id !== device_id || p.player_session_token !== player_token) {
      return reply.code(403).send({ ok: false, error: "TOKEN_INVALID" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ ok: false, error: "NO_FILE" });

    const mime = String(file.mimetype || "");
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) {
      return reply.code(415).send({ ok: false, error: "UNSUPPORTED_MIME" });
    }

    const buf = await file.toBuffer();

    const outDir = path.join(TEMP_DIR, "lobby", join_code);
    await ensureDir(outDir);

    const outName = `${player_id}.jpg`;
    const outPath = path.join(outDir, outName);

    const jpeg = await sharp(buf)
      .rotate()
      .resize(400, 400, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();

    await fs.writeFile(outPath, jpeg);

    const temp_photo_url = `/temp/lobby/${join_code}/${outName}`;

    p.photo_url = temp_photo_url;
    await saveLobby(lobby);

    // ✅ instant broadcast
    await broadcastLobbyStateNow(join_code);

    return reply.send({ ok: true, temp_photo_url });
  });
}
