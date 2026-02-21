import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { ack, err, WSMsg } from "./protocol";
import { prisma } from "../db/prisma";

type Role = "master" | "play";
type Conn = { ws: WebSocket; role: Role; room_code: string };

const connsByRoom = new Map<string, Set<Conn>>();

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

function send(ws: WebSocket, msg: any) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {}
}
function broadcast(room_code: string, msg: any, roles?: Role[]) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  for (const c of set) {
    if (roles && !roles.includes(c.role)) continue;
    send(c.ws, msg);
  }
}

function onlyMaster<T extends object>(payload: T, isMaster: boolean): Partial<T> {
  return isMaster ? payload : {};
}

async function buildStateSync(room_code: string, role: Role) {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    include: {
      senders: true,
      players: true,
      rounds: {
        orderBy: { index: "asc" },
        include: {
          items: {
            orderBy: { orderIndex: "asc" },
            include: {
              reelItem: true,
              truths: true
            }
          }
        }
      }
    }
  });
  if (!room) return null;

  const round = room.rounds[room.currentRoundIndex] || room.rounds[0] || null;
  const items = round ? round.items : [];
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
  const remaining_senders = Array.from(allTruth).filter((id) => !resolvedTruth.has(id));

  // votes for focus by player (Play uses this to show “Vote reçu”)
  const votes_for_focus: Record<string, string[]> = {};
  if (focus) {
    const rows = await prisma.vote.findMany({
      where: { roomId: room.id, roundItemId: focus.id },
      select: { playerId: true, senderId: true }
    });
    for (const r of rows) {
      if (!votes_for_focus[r.playerId]) votes_for_focus[r.playerId] = [];
      votes_for_focus[r.playerId].push(r.senderId);
    }
  }

  const isMaster = role === "master";

  const senders = room.senders.map((s) => ({
    id_local: s.id,
    name: s.name,
    active: s.active,
    photo_url: s.photoUrl ?? null,
    color_token: s.color
  }));

  const players = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    photo_url: p.photoUrl ?? null,
    score: p.score
  }));

  const roundPayload = round
    ? {
        index: round.index,
        items: items.map((it) => ({
          id: it.id,
          k: it.k,
          opened: it.opened,
          resolved: it.resolved,
          ...onlyMaster({ reel_url: it.reelItem.url }, isMaster)
        }))
      }
    : null;

  const focusPayload = focus
    ? {
        id: focus.id,
        k: focus.k,
        opened: focus.opened,
        resolved: focus.resolved,
        ...onlyMaster({ reel_url: focus.reelItem.url }, isMaster)
      }
    : null;

  return {
    room_code: room.roomCode,
    phase: room.status,
    current_phase: room.phase,
    current_round_index: room.currentRoundIndex,
    current_item_index: room.currentItemIndex,
    timer_end_ts: room.timerEndAt ? room.timerEndAt.getTime() : null,
    senders,
    players,
    round: roundPayload,
    focus_item: focusPayload,
    remaining_senders,
    votes_for_focus
  };
}

async function broadcastState(room_code: string) {
  const master = await buildStateSync(room_code, "master");
  const play = await buildStateSync(room_code, "play");
  if (master) broadcast(room_code, { type: "state_sync", ts: Date.now(), payload: master }, ["master"]);
  if (play) broadcast(room_code, { type: "state_sync", ts: Date.now(), payload: play }, ["play"]);
}

async function getFocusItem(room_code: string) {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    include: {
      rounds: {
        orderBy: { index: "asc" },
        include: {
          items: { orderBy: { orderIndex: "asc" }, include: { truths: true, reelItem: true } }
        }
      }
    }
  });
  if (!room) return null;
  const round = room.rounds[room.currentRoundIndex] || room.rounds[0] || null;
  if (!round) return null;
  const item = round.items[room.currentItemIndex] || round.items[0] || null;
  return { room, round, item };
}

async function ensurePhase(roomCode: string, phase: string, timerEndAt: Date | null = null) {
  await prisma.room.update({
    where: { roomCode },
    data: { phase, timerEndAt }
  });
}

async function allActivePlayersVoted(roomId: string, roundItemId: string) {
  const players = await prisma.player.findMany({
    where: { roomId, active: true },
    select: { id: true }
  });
  const activeIds = players.map((p) => p.id);
  if (activeIds.length === 0) return false;

  const votes = await prisma.vote.findMany({
    where: { roomId, roundItemId },
    select: { playerId: true }
  });
  const voted = new Set(votes.map((v) => v.playerId));
  return activeIds.every((id) => voted.has(id));
}

const timers = new Map<string, NodeJS.Timeout>();
const reveals = new Map<string, NodeJS.Timeout>();

function clearTimer(room_code: string) {
  const t = timers.get(room_code);
  if (t) clearTimeout(t);
  timers.delete(room_code);
}
function clearReveal(room_code: string) {
  const t = reveals.get(room_code);
  if (t) clearTimeout(t);
  reveals.delete(room_code);
}

async function closeVotingAndReveal(room_code: string, reason: "all_voted" | "timer_end" | "force_close") {
  const ctx = await getFocusItem(room_code);
  if (!ctx || !ctx.item) return;

  await ensurePhase(room_code, "REVEAL_SEQUENCE", null);
  clearTimer(room_code);

  broadcast(room_code, { type: "voting_closed", ts: Date.now(), payload: { reason, item_id: ctx.item.id } });

  // Step 1 payload: votes_by_player
  const votesRows = await prisma.vote.findMany({
    where: { roomId: ctx.room.id, roundItemId: ctx.item.id },
    select: { playerId: true, senderId: true }
  });
  const votes_by_player: Record<string, string[]> = {};
  for (const r of votesRows) {
    if (!votes_by_player[r.playerId]) votes_by_player[r.playerId] = [];
    votes_by_player[r.playerId].push(r.senderId);
  }

  // Truth
  const truth_sender_ids = ctx.item.truths.map((t) => t.senderId).slice().sort();

  // Correctness map
  const correctness_by_player_sender: Record<string, Record<string, boolean>> = {};
  for (const [pid, sel] of Object.entries(votes_by_player)) {
    correctness_by_player_sender[pid] = {};
    for (const sid of sel) correctness_by_player_sender[pid][sid] = truth_sender_ids.includes(sid);
  }

  // Step 1
  broadcast(room_code, {
    type: "reveal_step",
    ts: Date.now(),
    payload: { step: 1, item_id: ctx.item.id, votes_by_player }
  });

  // step scheduler (1s each)
  let step = 1;

  const tick = async () => {
    step++;

    if (step === 2) {
      broadcast(room_code, { type: "reveal_step", ts: Date.now(), payload: { step: 2, item_id: ctx.item!.id, truth_sender_ids } });
    }

    if (step === 3) {
      broadcast(room_code, {
        type: "reveal_step",
        ts: Date.now(),
        payload: { step: 3, item_id: ctx.item!.id, correctness_by_player_sender }
      });
    }

    if (step === 4) {
      // scoring: +1 per correct sender selected
      await prisma.$transaction(async (tx) => {
        const players = await tx.player.findMany({
          where: { roomId: ctx.room.id, active: true },
          select: { id: true, score: true }
        });

        for (const p of players) {
          const sel = votes_by_player[p.id] || [];
          let add = 0;
          for (const sid of sel) if (truth_sender_ids.includes(sid)) add++;
          if (add !== 0) {
            await tx.player.update({ where: { id: p.id }, data: { score: { increment: add } } });
          }
        }
      });

      broadcast(room_code, { type: "score_update", ts: Date.now(), payload: { item_id: ctx.item!.id } });
    }

    if (step === 5) {
      // mark item resolved
      await prisma.roundItem.update({
        where: { id: ctx.item!.id },
        data: { resolved: true }
      });

      broadcast(room_code, {
        type: "reveal_step",
        ts: Date.now(),
        payload: { step: 5, item_id: ctx.item!.id, truth_sender_ids }
      });
    }

    if (step === 6) {
      broadcast(room_code, { type: "reveal_step", ts: Date.now(), payload: { step: 6, item_id: ctx.item!.id } });

      // advance to next item / round / end
      await advanceAfterItem(room_code);
      await broadcastState(room_code);

      clearReveal(room_code);
      return;
    }

    reveals.set(room_code, setTimeout(() => tick().catch(() => {}), 1000));
  };

  clearReveal(room_code);
  reveals.set(room_code, setTimeout(() => tick().catch(() => {}), 1000));

  // keep clients synced during reveal
  await broadcastState(room_code);
}

async function advanceAfterItem(room_code: string) {
  const room = await prisma.room.findUnique({
    where: { roomCode: room_code },
    include: { rounds: { orderBy: { index: "asc" }, include: { items: { orderBy: { orderIndex: "asc" } } } } }
  });
  if (!room) return;

  const round = room.rounds[room.currentRoundIndex] || null;
  if (!round) {
    await prisma.room.update({ where: { roomCode: room_code }, data: { status: "GAME_END", phase: "GAME_END" } });
    broadcast(room_code, { type: "game_end", ts: Date.now(), payload: {} });
    return;
  }

  const items = round.items;
  const idx = room.currentItemIndex;

  const hasNextItem = idx + 1 < items.length;
  if (hasNextItem) {
    await prisma.room.update({
      where: { roomCode: room_code },
      data: { currentItemIndex: idx + 1, phase: "ROUND_INIT", timerEndAt: null }
    });
    return;
  }

  // round complete
  broadcast(room_code, { type: "round_complete", ts: Date.now(), payload: { round_index: round.index } });

  const hasNextRound = room.currentRoundIndex + 1 < room.rounds.length;
  if (hasNextRound) {
    await prisma.room.update({
      where: { roomCode: room_code },
      data: { currentRoundIndex: room.currentRoundIndex + 1, currentItemIndex: 0, phase: "ROUND_INIT", timerEndAt: null }
    });
    broadcast(room_code, { type: "round_started", ts: Date.now(), payload: { round_index: room.currentRoundIndex + 1 } });
    return;
  }

  // no more rounds => end
  await prisma.room.update({ where: { roomCode: room_code }, data: { status: "GAME_END", phase: "GAME_END", timerEndAt: null } });
  broadcast(room_code, { type: "game_end", ts: Date.now(), payload: {} });
}

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = (String((req.query as any).role || "play") as Role);

    const c: Conn = { ws: conn.socket, role, room_code };
    addConn(c);

    conn.socket.on("close", () => removeConn(c));

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg) return;

      // HELLO / READY
      if (msg.type === "master_hello" || msg.type === "play_hello") {
        const st = await buildStateSync(room_code, role);
        if (!st) {
          send(conn.socket, err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable"));
          return;
        }
        send(conn.socket, ack(msg.req_id, { ok: true }));
        send(conn.socket, { type: "state_sync", ts: Date.now(), payload: st });
        return;
      }

      if (msg.type === "master_ready" || msg.type === "play_ready") {
        const st = await buildStateSync(room_code, role);
        if (!st) {
          send(conn.socket, err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable"));
          return;
        }
        send(conn.socket, ack(msg.req_id, { ok: true }));
        send(conn.socket, { type: "state_sync", ts: Date.now(), payload: st });
        return;
      }

      // MASTER ACTIONS
      if (msg.type === "open_reel") {
        if (role !== "master") {
          send(conn.socket, err(msg.req_id, "FORBIDDEN", "Master only"));
          return;
        }
        const ctx = await getFocusItem(room_code);
        if (!ctx || !ctx.item) {
          send(conn.socket, err(msg.req_id, "NO_FOCUS", "Aucun item"));
          return;
        }
        if (ctx.item.resolved) {
          send(conn.socket, err(msg.req_id, "RESOLVED", "Item déjà résolu"));
          return;
        }

        await prisma.roundItem.update({ where: { id: ctx.item.id }, data: { opened: true } });
        await ensurePhase(room_code, "OPEN_REEL", null);

        send(conn.socket, ack(msg.req_id, { ok: true }));
        broadcast(room_code, { type: "reel_opened", ts: Date.now(), payload: { item_id: ctx.item.id } });
        await broadcastState(room_code);
        return;
      }

      if (msg.type === "start_voting") {
        if (role !== "master") {
          send(conn.socket, err(msg.req_id, "FORBIDDEN", "Master only"));
          return;
        }
        const ctx = await getFocusItem(room_code);
        if (!ctx || !ctx.item) {
          send(conn.socket, err(msg.req_id, "NO_FOCUS", "Aucun item"));
          return;
        }
        if (ctx.item.resolved) {
          send(conn.socket, err(msg.req_id, "RESOLVED", "Item déjà résolu"));
          return;
        }

        await ensurePhase(room_code, "VOTING", null);
        clearTimer(room_code);

        send(conn.socket, ack(msg.req_id, { ok: true }));

        const sendersActive = await prisma.sender.findMany({
          where: { roomId: ctx.room.id, active: true },
          select: { id: true }
        });

        broadcast(room_code, {
          type: "voting_started",
          ts: Date.now(),
          payload: { item_id: ctx.item.id, k: ctx.item.k, senders_active: sendersActive.map((s) => s.id) }
        });

        await broadcastState(room_code);
        return;
      }

      if (msg.type === "start_timer") {
        if (role !== "master") {
          send(conn.socket, err(msg.req_id, "FORBIDDEN", "Master only"));
          return;
        }
        const { duration } = msg.payload || {};
        const dur = Number(duration || 10);
        if (!Number.isFinite(dur) || dur <= 0 || dur > 60) {
          send(conn.socket, err(msg.req_id, "BAD_DURATION", "Durée invalide"));
          return;
        }

        const ctx = await getFocusItem(room_code);
        if (!ctx || !ctx.item) {
          send(conn.socket, err(msg.req_id, "NO_FOCUS", "Aucun item"));
          return;
        }

        const endsAt = new Date(Date.now() + dur * 1000);
        await ensurePhase(room_code, "TIMER_RUNNING", endsAt);

        clearTimer(room_code);
        timers.set(
          room_code,
          setTimeout(() => {
            closeVotingAndReveal(room_code, "timer_end").catch(() => {});
          }, dur * 1000)
        );

        send(conn.socket, ack(msg.req_id, { ok: true, ends_at: endsAt.getTime() }));
        broadcast(room_code, { type: "timer_started", ts: Date.now(), payload: { ends_at: endsAt.getTime() } });
        await broadcastState(room_code);
        return;
      }

      if (msg.type === "force_close_voting") {
        if (role !== "master") {
          send(conn.socket, err(msg.req_id, "FORBIDDEN", "Master only"));
          return;
        }
        send(conn.socket, ack(msg.req_id, { ok: true }));
        await closeVotingAndReveal(room_code, "force_close");
        return;
      }

      // PLAY ACTIONS
      if (msg.type === "cast_vote") {
        const { player_id, item_id, sender_ids } = msg.payload || {};
        const pid = String(player_id || "");
        const iid = String(item_id || "");
        const sids: string[] = Array.isArray(sender_ids) ? sender_ids.map(String) : [];

        if (!pid || !iid) {
          send(conn.socket, err(msg.req_id, "BAD_REQUEST", "Vote invalide"));
          return;
        }

        const ctx = await getFocusItem(room_code);
        if (!ctx || !ctx.item) {
          send(conn.socket, err(msg.req_id, "NO_FOCUS", "Aucun item"));
          return;
        }
        if (ctx.item.id !== iid) {
          send(conn.socket, err(msg.req_id, "NOT_FOCUS", "Pas l’item courant"));
          return;
        }

        // must be in voting or timer
        if (!["VOTING", "TIMER_RUNNING"].includes(ctx.room.phase)) {
          send(conn.socket, err(msg.req_id, "NOT_VOTING", "Vote fermé"));
          return;
        }

        // enforce active senders only
        const activeSenders = await prisma.sender.findMany({
          where: { roomId: ctx.room.id, active: true },
          select: { id: true }
        });
        const activeSet = new Set(activeSenders.map((s) => s.id));
        const filtered = sids.filter((id) => activeSet.has(id));

        // enforce max k (UI prevents, but server enforces)
        const limited = filtered.slice(0, ctx.item.k);

        // replace vote: delete old rows then insert
        await prisma.$transaction(async (tx) => {
          await tx.vote.deleteMany({ where: { roomId: ctx.room.id, roundItemId: iid, playerId: pid } });
          for (const sid of limited) {
            await tx.vote.create({ data: { roomId: ctx.room.id, roundItemId: iid, playerId: pid, senderId: sid } });
          }
        });

        send(conn.socket, ack(msg.req_id, { ok: true }));
        broadcast(room_code, { type: "vote_cast", ts: Date.now(), payload: { player_id: pid, item_id: iid } }, ["play"]);
        broadcast(room_code, { type: "vote_received", ts: Date.now(), payload: { player_id: pid, item_id: iid } }, ["master"]);

        await broadcastState(room_code);

        // close if all voted (only if phase VOTING or TIMER_RUNNING)
        const ok = await allActivePlayersVoted(ctx.room.id, iid);
        if (ok) {
          await closeVotingAndReveal(room_code, "all_voted");
        }

        return;
      }

      send(conn.socket, err(msg.req_id, "UNKNOWN", "Message inconnu"));
    });

    // auto push current state
    const st = await buildStateSync(room_code, role);
    if (st) send(conn.socket, { type: "state_sync", ts: Date.now(), payload: st });
  });
}
