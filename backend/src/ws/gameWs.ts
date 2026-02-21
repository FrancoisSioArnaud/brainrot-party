import { FastifyInstance } from "fastify";
import { ack, err, WSMsg } from "./protocol";
import { prisma } from "../db/prisma";

function send(ws: any, msg: any) {
  try { ws.send(JSON.stringify(msg)); } catch {}
}

async function buildStateSync(room_code: string, role: "master" | "play") {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    include: {
      senders: true,
      players: true,
      rounds: {
        include: {
          items: {
            include: { reelItem: true, truths: true }
          }
        },
        orderBy: { index: "asc" }
      }
    }
  });
  if (!room) return null;

  const round = room.rounds[room.currentRoundIndex] || room.rounds[0] || null;
  const items = round ? [...round.items].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const focus = items[room.currentItemIndex] || items[0] || null;

  // remaining senders (round scope)
  const allTruth = new Set<string>();
  const resolvedTruth = new Set<string>();
  for (const it of items) {
    for (const t of it.truths) {
      allTruth.add(t.senderId);
      if (it.resolved) resolvedTruth.add(t.senderId);
    }
  }
  const remaining_sender_ids = Array.from(allTruth).filter((id) => !resolvedTruth.has(id));

  const reel_urls_by_item: Record<string, string> = {};
  for (const it of items) reel_urls_by_item[it.id] = it.reelItem.url;

  return {
    room: {
      room_code: room.roomCode,
      status: room.status,
      phase: room.phase,
      current_round_index: room.currentRoundIndex,
      current_item_index: room.currentItemIndex,
      timer_end_ts: room.timerEndAt ? room.timerEndAt.getTime() : null
    },
    senders: room.senders.map((s) => ({
      id: s.id,
      name: s.name,
      photo_url: s.photoUrl ?? null,
      color_token: s.color,
      active: s.active
    })),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      photo_url: p.photoUrl ?? null,
      active: p.active,
      score: p.score
    })),
    round: {
      items_ordered: items.map((it) => ({
        id: it.id,
        k: it.k,
        opened: it.opened,
        resolved: it.resolved
      })),
      focus_item_id: focus?.id ?? null
    },
    ui_state: {
      remaining_sender_ids,
      revealed_slots_by_item: {},
      current_votes_by_player: {},
      ...(role === "master" ? { reel_urls_by_item } : {})
    }
  };
}

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = (String((req.query as any).role || "play") as "master" | "play");

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg) return;

      if (msg.type === "master_hello") {
        const st = await buildStateSync(room_code, "master");
        if (!st) {
          send(conn.socket, err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable"));
          return;
        }
        send(conn.socket, ack(msg.req_id, { ok: true }));
        send(conn.socket, { type: "state_sync", ts: Date.now(), payload: st });
        return;
      }

      if (msg.type === "play_hello") {
        const st = await buildStateSync(room_code, "play");
        if (!st) {
          send(conn.socket, err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable"));
          return;
        }
        send(conn.socket, ack(msg.req_id, { ok: true }));
        send(conn.socket, { type: "state_sync", ts: Date.now(), payload: st });
        return;
      }

      send(conn.socket, err(msg.req_id, "NOT_IMPLEMENTED", "Game WS pas encore implémenté"));
    });
  });
}
