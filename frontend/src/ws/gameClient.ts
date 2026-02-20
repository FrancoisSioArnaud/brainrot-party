import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { getGame } from "../state/gameStore";

type Conn = { ws: WebSocket; role: "master" | "play" };

const connsByRoom = new Map<string, Set<Conn>>();

function send(ws: WebSocket, msg: any) {
  ws.send(JSON.stringify(msg));
}

function broadcast(room_code: string, msg: any) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  for (const c of set) {
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {}
  }
}

function addConn(room_code: string, c: Conn) {
  const set = connsByRoom.get(room_code) || new Set<Conn>();
  set.add(c);
  connsByRoom.set(room_code, set);
}

function removeConn(room_code: string, c: Conn) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  set.delete(c);
  if (set.size === 0) connsByRoom.delete(room_code);
}

function toStateSync(game: any) {
  // MVP contract: allow clients to render something stable
  return {
    room_code: game.room_code,
    phase: game.phase,
    timer_end_ts: game.timer_end_ts ?? null,
    senders: game.senders || [],
    players: (game.players || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      active: !!p.active,
      photo_url: p.photo_url ?? null,
      score: Number(p.score || 0),
      type: p.type,
      sender_id_local: p.sender_id_local ?? null,
    })),
  };
}

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = String((req.query as any).role || "play") as "master" | "play";
    const c: Conn = { ws: conn.socket, role };

    addConn(room_code, c);

    conn.socket.on("message", async (raw) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg?.type) return;

      // MVP: on ignore tout sauf "ready", et on renvoie state_sync
      if (msg.type === "master_ready" || msg.type === "play_ready") {
        const game = await getGame(room_code);
        if (!game) {
          send(conn.socket, { type: "error", ts: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room introuvable" } });
          return;
        }
        send(conn.socket, { type: "state_sync", ts: Date.now(), payload: toStateSync(game) });
        return;
      }
    });

    conn.socket.on("close", () => removeConn(room_code, c));

    // auto push state_sync on connect (best-effort)
    const game = await getGame(room_code);
    if (!game) {
      send(conn.socket, { type: "error", ts: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room introuvable" } });
      return;
    }

    send(conn.socket, { type: "state_sync", ts: Date.now(), payload: toStateSync(game) });
    broadcast(room_code, { type: "presence", ts: Date.now(), payload: { role } });
  });
}
