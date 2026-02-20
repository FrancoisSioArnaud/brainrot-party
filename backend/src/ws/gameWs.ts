import { FastifyInstance } from "fastify";
import { ack, err, WSMsg } from "./protocol";
import { getGame } from "../state/gameStore";

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = String((req.query as any).role || "play");

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg) return;

      // Placeholder: only state_sync if game exists
      if (msg.type === "master_hello" || msg.type === "play_hello") {
        const st = await getGame(room_code);
        if (!st) {
          conn.socket.send(JSON.stringify(err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable")));
          return;
        }
        conn.socket.send(JSON.stringify(ack(msg.req_id, { ok: true })));
        conn.socket.send(JSON.stringify({ type: "state_sync", ts: Date.now(), payload: st }));
        return;
      }

      conn.socket.send(JSON.stringify(err(msg.req_id, "NOT_IMPLEMENTED", "Game WS pas encore implémenté")));
    });
  });
}
