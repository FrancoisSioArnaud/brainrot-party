import { FastifyInstance } from "fastify";
import type { RawData, WebSocket as WsWebSocket } from "ws";
import type { Prisma } from "@prisma/client";
import { ack, err, WSMsg } from "./protocol";
import { prisma } from "../db/prisma";

type Role = "master" | "play";
type Conn = { ws: WsWebSocket; role: Role; room_code: string };

const connsByRoom = new Map<string, Set<Conn>>();

function safeErrMessage(e: unknown): string {
  if (!e) return "UNKNOWN";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || e.name;
  try {
    return JSON.stringify(e);
  } catch {
    return "UNKNOWN";
  }
}

function mapPrismaError(e: unknown): { code: string; message: string } {
  const msg = safeErrMessage(e);
  const anyE: any = e as any;
  const prismaCode = anyE?.code ? String(anyE.code) : "";

  // Prisma known request errors (ex: P2003 FK)
  if (prismaCode === "P2003") return { code: "FK_VIOLATION", message: "Référence invalide (FK)" };
  if (prismaCode === "P2025") return { code: "NOT_FOUND", message: "Élément introuvable (P2025)" };
  if (prismaCode) return { code: `PRISMA_${prismaCode}`, message: `Erreur Prisma ${prismaCode}` };

  return { code: "INTERNAL", message: msg.slice(0, 160) };
}

function addConn(c: Conn) {
  const set = connsByRoom.get(c.room_code) || new Set<Conn>();
  set.add(c);
  connsByRoom.set(c.room_code, set);
}

function removeConn(c: Conn) {
  const set = connsByRoom.get(c.room_code);
  if (!set) return;
  set.delete(c);
  if (set.size === 0) connsByRoom.delete(c.room_code);
}

function send(ws: WsWebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

function broadcast(room_code: string, msg: unknown, roles?: Role[]) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  for (const c of set) {
    if (roles && !roles.includes(c.role)) continue;
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {}
  }
}

async function buildStateSync(room_code: string) {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    select: {
      id: true,
      roomCode: true,
      status: true,
      phase: true,
      currentRoundIndex: true,
      currentItemIndex: true,
      timerEndAt: true,
    },
  });
  if (!room) return null;

  const senders = await prisma.sender.findMany({
    where: { roomId: room.id },
    select: { id: true, name: true, photoUrl: true, color: true, active: true },
    orderBy: { name: "asc" },
  });

  const players = await prisma.player.findMany({
    where: { roomId: room.id },
    select: { id: true, name: true, photoUrl: true, active: true, score: true },
    orderBy: { name: "asc" },
  });

  const round = await prisma.round.findFirst({
    where: { roomId: room.id, index: room.currentRoundIndex },
    select: { id: true },
  });

  let items: any[] = [];
  if (round) {
    const rows = await prisma.roundItem.findMany({
      where: { roundId: round.id },
      select: { id: true, k: true, opened: true, resolved: true, orderIndex: true, reelItemId: true },
      orderBy: { orderIndex: "asc" },
    });

    const truths = await prisma.roundItemTruth.findMany({
      where: { roundItemId: { in: rows.map((r) => r.id) } },
      select: { roundItemId: true, senderId: true },
    });

    const truthMap = new Map<string, string[]>();
    for (const t of truths) {
      const arr = truthMap.get(t.roundItemId) || [];
      arr.push(t.senderId);
      truthMap.set(t.roundItemId, arr);
    }

    items = rows.map((r) => ({
      id: r.id,
      k: r.k,
      opened: r.opened,
      resolved: r.resolved,
      order_index: r.orderIndex,
      truth_sender_ids: truthMap.get(r.id) || [],
    }));
  }

  // remaining_senders (round-scope)
  let remaining_sender_ids: string[] = [];
  if (items.length > 0) {
    const allTruth = new Set<string>();
    const resolvedTruth = new Set<string>();
    for (const it of items) {
      for (const sid of it.truth_sender_ids || []) allTruth.add(sid);
      if (it.resolved) for (const sid of it.truth_sender_ids || []) resolvedTruth.add(sid);
    }
    remaining_sender_ids = Array.from(allTruth).filter((x) => !resolvedTruth.has(x));
  }

  // votes already received for current item (master UI pancartes)
  let votes_by_player: Record<string, string[]> = {};
  const focusItem = items[room.currentItemIndex] || null;
  if (focusItem && ["VOTING", "TIMER_RUNNING", "REVEAL_SEQUENCE"].includes(room.phase)) {
    const votes = await prisma.vote.findMany({
      where: { roomId: room.id, roundItemId: focusItem.id },
      select: { playerId: true, senderId: true },
    });
    for (const v of votes) {
      const arr = votes_by_player[v.playerId] || [];
      arr.push(v.senderId);
      votes_by_player[v.playerId] = arr;
    }
  }

  return {
    room: {
      room_code: room.roomCode,
      status: room.status,
      phase: room.phase,
      current_round_index: room.currentRoundIndex,
      current_item_index: room.currentItemIndex,
      timer_end_at: room.timerEndAt ? room.timerEndAt.getTime() : null,
    },
    senders,
    players,
    round_items: items,
    remaining_sender_ids,
    votes_by_player,
  };
}

async function broadcastState(room_code: string) {
  const st = await buildStateSync(room_code);
  if (!st) return;
  broadcast(room_code, { type: "state_sync", ts: Date.now(), payload: st });
}

async function getFocusItem(room_code: string) {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    select: { id: true, phase: true, currentRoundIndex: true, currentItemIndex: true, status: true },
  });
  if (!room) return null;

  const round = await prisma.round.findFirst({
    where: { roomId: room.id, index: room.currentRoundIndex },
    select: { id: true },
  });
  if (!round) return { room, round: null, item: null };

  const items = await prisma.roundItem.findMany({
    where: { roundId: round.id },
    select: { id: true, k: true, opened: true, resolved: true, orderIndex: true },
    orderBy: { orderIndex: "asc" },
  });
  const item = items[room.currentItemIndex] || null;

  return { room, round, item, items };
}

async function closeVotingAndReveal(room_code: string, reason: "all_voted" | "timer_end" | "force_close") {
  const ctx = await getFocusItem(room_code);
  if (!ctx || !ctx.room || !ctx.item) return;

  // close
  await prisma.room.update({
    where: { id: ctx.room.id },
    data: { phase: "REVEAL_SEQUENCE", timerEndAt: null },
  });

  broadcast(room_code, { type: "voting_closed", ts: Date.now(), payload: { reason, item_id: ctx.item.id } });
  await broadcastState(room_code);

  // Reveal: minimal MVP (tu as déjà ta logique, on ne change pas ici)
}

async function maybeAutoCloseVotingIfAllVoted(room_code: string) {
  const ctx = await getFocusItem(room_code);
  if (!ctx || !ctx.room || !ctx.item) return false;
  if (!["VOTING", "TIMER_RUNNING"].includes(ctx.room.phase)) return false;

  const activePlayers = await prisma.player.findMany({
    where: { roomId: ctx.room.id, active: true },
    select: { id: true },
  });

  const votes = await prisma.vote.findMany({
    where: { roomId: ctx.room.id, roundItemId: ctx.item.id },
    select: { playerId: true },
  });
  const votedSet = new Set(votes.map((v) => v.playerId));

  const allVoted = activePlayers.every((p) => votedSet.has(p.id));
  if (!allVoted) return false;

  await closeVotingAndReveal(room_code, "all_voted");
  return true;
}

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn: any, req: any) => {
    const room_code = String((req.params as any).roomCode || "").toUpperCase();
    const role = (String((req.query as any).role || "play") as Role) || "play";

    const ws = conn.socket as WsWebSocket;
    const c: Conn = { ws, role, room_code };
    addConn(c);

    ws.on("close", () => removeConn(c));

    ws.on("message", async (raw: RawData) => {
      let msg: WSMsg | null = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg) return;

      try {
        // HELLO
        if (msg.type === "master_hello" || msg.type === "play_hello") {
          const st = await buildStateSync(room_code);
          if (!st) {
            send(ws, err(msg.req_id, "ROOM_NOT_FOUND", "Room introuvable"));
            return;
          }
          send(ws, ack(msg.req_id, { ok: true }));
          send(ws, { type: "state_sync", ts: Date.now(), payload: st });
          return;
        }

        // MASTER
        if (role === "master" && msg.type === "open_reel") {
          const { item_id } = msg.payload || {};
          const iid = String(item_id || "");

          const ctx = await getFocusItem(room_code);
          if (!ctx || !ctx.room || !ctx.item) {
            send(ws, err(msg.req_id, "NO_FOCUS", "Aucun item"));
            return;
          }
          if (ctx.item.id !== iid) {
            send(ws, err(msg.req_id, "NOT_FOCUS", "Pas l’item courant"));
            return;
          }

          // mark opened + switch to VOTING (selon tes specs)
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.roundItem.update({ where: { id: iid }, data: { opened: true } });
            await tx.room.update({ where: { id: ctx.room.id }, data: { phase: "VOTING", timerEndAt: null } });
          });

          broadcast(room_code, { type: "reel_opened", ts: Date.now(), payload: { item_id: iid } });
          broadcast(room_code, { type: "voting_started", ts: Date.now(), payload: { item_id: iid, k: ctx.item.k } });
          await broadcastState(room_code);

          send(ws, ack(msg.req_id, { ok: true }));
          return;
        }

        if (role === "master" && msg.type === "start_timer") {
          const { duration } = msg.payload || {};
          const dur = Number(duration || 10);
          const seconds = Number.isFinite(dur) ? Math.max(1, Math.min(60, dur)) : 10;

          const ctx = await getFocusItem(room_code);
          if (!ctx || !ctx.room || !ctx.item) {
            send(ws, err(msg.req_id, "NO_FOCUS", "Aucun item"));
            return;
          }
          if (!["VOTING", "TIMER_RUNNING"].includes(ctx.room.phase)) {
            send(ws, err(msg.req_id, "NOT_VOTING", "Vote fermé"));
            return;
          }

          const ends = new Date(Date.now() + seconds * 1000);
          await prisma.room.update({
            where: { id: ctx.room.id },
            data: { phase: "TIMER_RUNNING", timerEndAt: ends },
          });

          broadcast(room_code, { type: "timer_started", ts: Date.now(), payload: { ends_at: ends.getTime() } });
          await broadcastState(room_code);
          send(ws, ack(msg.req_id, { ok: true }));
          return;
        }

        if (role === "master" && msg.type === "force_close_voting") {
          const ctx = await getFocusItem(room_code);
          if (!ctx || !ctx.room || !ctx.item) {
            send(ws, err(msg.req_id, "NO_FOCUS", "Aucun item"));
            return;
          }
          if (!["VOTING", "TIMER_RUNNING"].includes(ctx.room.phase)) {
            send(ws, err(msg.req_id, "NOT_VOTING", "Vote fermé"));
            return;
          }
          send(ws, ack(msg.req_id, { ok: true }));
          await closeVotingAndReveal(room_code, "force_close");
          return;
        }

        // PLAY
        if (msg.type === "cast_vote") {
          const { player_id, item_id, sender_ids } = msg.payload || {};
          const pid = String(player_id || "");
          const iid = String(item_id || "");
          const sids: string[] = Array.isArray(sender_ids) ? sender_ids.map(String) : [];

          if (!pid || !iid) {
            send(ws, err(msg.req_id, "BAD_REQUEST", "Vote invalide"));
            return;
          }

          const ctx = await getFocusItem(room_code);
          if (!ctx || !ctx.item) {
            send(ws, err(msg.req_id, "NO_FOCUS", "Aucun item"));
            return;
          }
          if (ctx.item.id !== iid) {
            send(ws, err(msg.req_id, "NOT_FOCUS", "Pas l’item courant"));
            return;
          }

          if (!["VOTING", "TIMER_RUNNING"].includes(ctx.room.phase)) {
            send(ws, err(msg.req_id, "NOT_VOTING", "Vote fermé"));
            return;
          }

          const player = await prisma.player.findFirst({
            where: { id: pid, roomId: ctx.room.id, active: true },
            select: { id: true },
          });
          if (!player) {
            send(ws, err(msg.req_id, "PLAYER_NOT_FOUND", "Player introuvable ou inactif"));
            return;
          }

          const activeSenders = await prisma.sender.findMany({
            where: { roomId: ctx.room.id, active: true },
            select: { id: true },
          });
          const activeSet = new Set(activeSenders.map((s) => s.id));
          const filtered = sids.filter((id: string) => activeSet.has(id));
          const limited = filtered.slice(0, ctx.item.k);

          try {
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
              await tx.vote.deleteMany({ where: { roomId: ctx.room.id, roundItemId: iid, playerId: pid } });
              for (const sid of limited) {
                await tx.vote.create({
                  data: { roomId: ctx.room.id, roundItemId: iid, playerId: pid, senderId: sid },
                });
              }
            });
          } catch (e) {
            const info = mapPrismaError(e);
            send(ws, err(msg.req_id, info.code, info.message));
            return;
          }

          send(ws, ack(msg.req_id, { ok: true }));
          broadcast(room_code, { type: "vote_cast", ts: Date.now(), payload: { player_id: pid, item_id: iid } }, ["play"]);
          broadcast(room_code, { type: "vote_received", ts: Date.now(), payload: { player_id: pid, item_id: iid } }, ["master"]);

          await broadcastState(room_code);

          // auto close when all voted
          await maybeAutoCloseVotingIfAllVoted(room_code);
          return;
        }

        send(ws, err(msg.req_id, "UNKNOWN", "Message inconnu"));
        return;
      } catch (e) {
        const info = mapPrismaError(e);
        // don't crash the process on per-client errors
        send(ws, err(msg?.req_id, info.code, info.message));
        return;
      }
    });

    // initial state
    const st = await buildStateSync(room_code);
    if (st) send(ws, { type: "state_sync", ts: Date.now(), payload: st });
  });
}
