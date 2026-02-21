import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { ack, err, WSMsg } from "./protocol";
import { getLobby, saveLobby, LobbyState, LobbyPlayer } from "../state/lobbyStore";
import { redis } from "../state/redis";
import { prisma } from "../db/prisma";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

type Conn = { ws: WebSocket; role: "master" | "play"; device_id?: string };

const lobbyConnections = new Map<string, Set<Conn>>();
const lobbyIntervals = new Map<string, NodeJS.Timeout>();

const PING_TIMEOUT_MS = 30_000;
const AFK_GRACE_MS = 15_000;
const TICK_MS = 1_000;

const CLAIM_LOCK_TTL_MS = 1500;
function lockKey(join_code: string, player_id: string) {
  return `brp:lobby:claim_lock:${join_code}:${player_id}`;
}
async function acquireClaimLock(join_code: string, player_id: string) {
  const res = await redis.set(lockKey(join_code, player_id), "1", "PX", CLAIM_LOCK_TTL_MS, "NX");
  return res === "OK";
}
async function releaseClaimLock(join_code: string, player_id: string) {
  try { await redis.del(lockKey(join_code, player_id)); } catch {}
}

function broadcast(join_code: string, msg: any) {
  const conns = lobbyConnections.get(join_code);
  if (!conns) return;
  for (const c of conns) {
    try { c.ws.send(JSON.stringify(msg)); } catch {}
  }
}
function send(ws: WebSocket, msg: any) {
  ws.send(JSON.stringify(msg));
}

function upsertConn(join_code: string, conn: Conn) {
  const set = lobbyConnections.get(join_code) || new Set<Conn>();
  set.add(conn);
  lobbyConnections.set(join_code, set);
  ensureTicker(join_code);
}
function removeConn(join_code: string, conn: Conn) {
  const set = lobbyConnections.get(join_code);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    lobbyConnections.delete(join_code);
    stopTicker(join_code);
  }
}
function ensureTicker(join_code: string) {
  if (lobbyIntervals.has(join_code)) return;
  const t = setInterval(() => tick(join_code).catch(() => {}), TICK_MS);
  lobbyIntervals.set(join_code, t);
}
function stopTicker(join_code: string) {
  const t = lobbyIntervals.get(join_code);
  if (t) clearInterval(t);
  lobbyIntervals.delete(join_code);
}

function lobbyStatePayload(state: LobbyState) {
  const now = Date.now();
  return {
    join_code: state.join_code,
    players: state.players.map(p => ({
      id: p.id,
      type: p.type,
      sender_id_local: p.sender_id_local,
      active: p.active,
      name: p.name,
      status: p.status,
      photo_url: p.photo_url,
      afk_expires_at_ms: p.afk_expires_at_ms,
      afk_seconds_left: p.afk_expires_at_ms ? Math.max(0, Math.ceil((p.afk_expires_at_ms - now) / 1000)) : null
    })),
    senders: state.senders
  };
}

function hashToColorToken(input: string) {
  const h = crypto.createHash("sha1").update(input).digest("hex");
  return `c_${h.slice(0, 8)}`;
}

type DraftReelItem = { url: string; sender_local_ids: string[] };
function normalizeDraftReelItems(draft: any): DraftReelItem[] {
  const arr: any[] =
    Array.isArray(draft?.reel_items) ? draft.reel_items :
    Array.isArray(draft?.reelItems) ? draft.reelItems :
    Array.isArray(draft?.reel_items_by_url) ? draft.reel_items_by_url :
    [];

  const out: DraftReelItem[] = [];

  // Object map shape: { url: { url, sender_local_ids } }
  if (!arr.length && draft?.reelItemsByUrl && typeof draft.reelItemsByUrl === "object") {
    for (const k of Object.keys(draft.reelItemsByUrl)) {
      const v = draft.reelItemsByUrl[k];
      const url = String(v?.url || k || "");
      const sender_local_ids = Array.isArray(v?.sender_local_ids)
        ? v.sender_local_ids.map(String)
        : Array.isArray(v?.sender_ids)
          ? v.sender_ids.map(String)
          : [];
      if (url && sender_local_ids.length) out.push({ url, sender_local_ids });
    }
    return out;
  }

  for (const it of arr) {
    const url = String(it?.url || "");
    const sender_local_ids = Array.isArray(it?.sender_local_ids)
      ? it.sender_local_ids.map(String)
      : Array.isArray(it?.sender_ids)
        ? it.sender_ids.map(String)
        : [];
    if (!url || sender_local_ids.length === 0) continue;
    out.push({ url, sender_local_ids });
  }
  return out;
}

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const a = [...arr];
  const seed = crypto.createHash("sha256").update(seedStr).digest();
  let s = seed.readUInt32LE(0);
  const rnd = () => {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function copyTempPhotoToRoom(join_code: string, room_code: string, player_ephemeral_id: string): Promise<string | null> {
  const base = path.resolve(process.env.BRP_TEMP_DIR || "/tmp/brp");
  const src = path.join(base, "lobby", join_code, `${player_ephemeral_id}.jpg`);
  try {
    await fs.stat(src);
  } catch {
    return null;
  }
  const outDir = path.join(base, "media", "rooms", room_code, "players");
  await fs.mkdir(outDir, { recursive: true });
  const dst = path.join(outDir, `${player_ephemeral_id}.jpg`);
  await fs.copyFile(src, dst);
  return `/media/rooms/${room_code}/players/${player_ephemeral_id}.jpg`;
}

async function buildAndPersistRoomFromLobby(state: LobbyState) {
  const join_code = state.join_code;
  const room_code = join_code; // MVP: keep same code
  const seed = crypto.randomUUID();

  const activeSenders = state.senders.filter(s => s.active);
  if (activeSenders.length < 2) throw new Error("NEED_2_SENDERS");

  const activePlayers = state.players.filter(p => p.active && p.status !== "disabled");
  const okPlayers = activePlayers.filter(p => p.status === "connected" || p.status === "afk");
  if (activePlayers.length < 2) throw new Error("NEED_2_PLAYERS");
  if (okPlayers.length !== activePlayers.length) throw new Error("NOT_ALL_CONNECTED");

  // Filter reel items by active senders
  const activeSenderIdSet = new Set(activeSenders.map(s => s.id_local));
  const reelItemsDraft = (state.reel_items || []).map(it => ({
    url: it.url,
    sender_local_ids: it.sender_local_ids.filter(id => activeSenderIdSet.has(id))
  })).filter(it => it.sender_local_ids.length > 0);

  if (reelItemsDraft.length === 0) throw new Error("NO_REELS");

  const created = await prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        roomCode: room_code,
        seed,
        status: "IN_GAME",
        phase: "ROUND_INIT",
        currentRoundIndex: 0,
        currentItemIndex: 0,
        timerEndAt: null
      }
    });

    // Senders
    const senderByLocal = new Map<string, { id: string; name: string }>();
    for (const s of activeSenders) {
      const row = await tx.sender.create({
        data: {
          roomId: room.id,
          name: s.name,
          active: true,
          color: hashToColorToken(s.id_local),
          photoUrl: null
        }
      });
      senderByLocal.set(s.id_local, { id: row.id, name: row.name });
    }

    // Players + links + photo inheritance
    for (const p of state.players) {
      if (!p.active || p.status === "disabled") continue;

      const photoUrl = await copyTempPhotoToRoom(join_code, room_code, p.id);
      const pl = await tx.player.create({
        data: {
          roomId: room.id,
          name: p.name,
          active: true,
          score: 0,
          photoUrl
        }
      });

      if (p.type === "sender_linked" && p.sender_id_local) {
        const sender = senderByLocal.get(p.sender_id_local);
        await tx.playerSenderLink.create({
          data: {
            roomId: room.id,
            playerId: pl.id,
            senderId: sender?.id ?? null
          }
        });

        if (sender?.id && photoUrl) {
          await tx.sender.update({ where: { id: sender.id }, data: { photoUrl } });
        }
      } else {
        await tx.playerSenderLink.create({
          data: {
            roomId: room.id,
            playerId: pl.id,
            senderId: null
          }
        });
      }
    }

    // ReelItems + M2M
    const reelIdByUrl = new Map<string, string>();
    for (const it of reelItemsDraft) {
      const r = await tx.reelItem.create({ data: { roomId: room.id, url: it.url } });
      reelIdByUrl.set(it.url, r.id);

      for (const sidLocal of it.sender_local_ids) {
        const sender = senderByLocal.get(sidLocal);
        if (!sender) continue;
        await tx.reelItemSender.create({ data: { reelItemId: r.id, senderId: sender.id } });
      }
    }

    // Pools per sender
    const pools = new Map<string, string[]>(); // senderId -> reelItemIds
    for (const [localId, sender] of senderByLocal.entries()) {
      const urls = reelItemsDraft.filter(x => x.sender_local_ids.includes(localId)).map(x => x.url);
      const ids = urls.map(u => reelIdByUrl.get(u)!).filter(Boolean);
      pools.set(sender.id, seededShuffle(ids, `${seed}:${sender.id}`));
    }

    // Build rounds until <=1 sender has remaining
    let roundIndex = 0;
    const rounds: Array<{ items: Array<{ reelItemId: string; truthSenderIds: string[]; k: number }> }> = [];

    while (true) {
      const sendersWithRemaining = Array.from(pools.entries()).filter(([, q]) => q.length > 0);
      if (sendersWithRemaining.length <= 1) break;

      // pick one per sender
      const picks: Array<{ senderId: string; reelItemId: string }> = [];
      for (const [senderId, q] of sendersWithRemaining) {
        const reelItemId = q.shift();
        if (reelItemId) picks.push({ senderId, reelItemId });
      }

      // group by reelItemId
      const grouped = new Map<string, string[]>();
      for (const pck of picks) {
        const list = grouped.get(pck.reelItemId) || [];
        list.push(pck.senderId);
        grouped.set(pck.reelItemId, list);
      }

      // consume globally
      for (const reelItemId of grouped.keys()) {
        for (const [, q] of pools.entries()) {
          const idx = q.indexOf(reelItemId);
          if (idx >= 0) q.splice(idx, 1);
        }
      }

      const itemsRaw = Array.from(grouped.entries()).map(([reelItemId, truthSenderIds]) => ({
        reelItemId,
        truthSenderIds: [...truthSenderIds].sort(),
        k: truthSenderIds.length
      }));

      // Order: multi first, then k desc, then seeded tie-break
      const withRand = itemsRaw.map((x) => ({
        ...x,
        r: crypto.createHash("sha1").update(`${seed}:${roundIndex}:${x.reelItemId}`).digest("hex")
      }));

      withRand.sort((a, b) => {
        const am = a.k > 1 ? 0 : 1;
        const bm = b.k > 1 ? 0 : 1;
        if (am !== bm) return am - bm;
        if (a.k !== b.k) return b.k - a.k;
        return a.r.localeCompare(b.r);
      });

      rounds.push({ items: withRand.map(({ reelItemId, truthSenderIds, k }) => ({ reelItemId, truthSenderIds, k })) });
      roundIndex++;
    }

    if (rounds.length === 0) {
      await tx.round.create({ data: { roomId: room.id, index: 0 } });
      return { room };
    }

    for (let ri = 0; ri < rounds.length; ri++) {
      const r = await tx.round.create({ data: { roomId: room.id, index: ri } });
      const items = rounds[ri].items;

      for (let oi = 0; oi < items.length; oi++) {
        const it = items[oi];
        const itemRow = await tx.roundItem.create({
          data: {
            roundId: r.id,
            reelItemId: it.reelItemId,
            orderIndex: oi,
            k: it.k,
            opened: false,
            resolved: false
          }
        });

        for (const senderId of it.truthSenderIds) {
          await tx.roundItemTruth.create({ data: { roundItemId: itemRow.id, senderId } });
        }
      }
    }

    return { room };
  });

  return { room_code, seed, room_id: created.room.id };
}

function releasePlayer(p: LobbyPlayer) {
  p.status = "free";
  p.device_id = null;
  p.player_session_token = null;
  p.last_ping_ms = null;
  p.afk_expires_at_ms = null;
}

async function tick(join_code: string) {
  const state = await getLobby(join_code);
  if (!state) return;

  const now = Date.now();
  let changed = false;

  for (const p of state.players) {
    if (!p.active || p.status === "disabled") continue;

    if (p.status === "connected") {
      const lp = p.last_ping_ms ?? 0;
      if (lp > 0 && now - lp >= PING_TIMEOUT_MS) {
        p.status = "afk";
        p.afk_expires_at_ms = now + AFK_GRACE_MS;
        changed = true;

        broadcast(join_code, {
          type: "player_afk",
          ts: now,
          payload: { player_id: p.id, seconds_left: Math.ceil(AFK_GRACE_MS / 1000) }
        });
      }
    }

    if (p.status === "afk" && p.afk_expires_at_ms) {
      const secondsLeft = Math.max(0, Math.ceil((p.afk_expires_at_ms - now) / 1000));
      broadcast(join_code, { type: "player_afk", ts: now, payload: { player_id: p.id, seconds_left: secondsLeft } });

      if (now >= p.afk_expires_at_ms) {
        const releasedPlayerId = p.id;
        releasePlayer(p);
        changed = true;
        broadcast(join_code, { type: "player_released", ts: now, payload: { player_id: releasedPlayerId } });
      }
    }
  }

  if (changed) {
    await saveLobby(state);
    broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
  }
}

export async function broadcastLobbyStateNow(join_code: string) {
  const st = await getLobby(join_code);
  if (!st) return;
  broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(st) });
}

export function closeLobbyWs(join_code: string, reason: "reset" | "start_game" | "unknown" = "unknown") {
  broadcast(join_code, { type: "lobby_closed", ts: Date.now(), payload: { reason } });

  const conns = lobbyConnections.get(join_code);
  if (conns) {
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
  }
  lobbyConnections.delete(join_code);
  stopTicker(join_code);
}

export async function registerLobbyWS(app: FastifyInstance) {
  app.get("/ws/lobby/:joinCode", { websocket: true }, async (conn, req) => {
    const join_code = String((req.params as any).joinCode || "");
    const role = (String((req.query as any).role || "play") as "master" | "play");
    const c: Conn = { ws: conn.socket, role };

    upsertConn(join_code, c);

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg) return;

      const state = await getLobby(join_code);
      if (!state) {
        send(conn.socket, err(msg.req_id, "LOBBY_NOT_FOUND", "Lobby introuvable"));
        return;
      }

      switch (msg.type) {
        case "master_hello": {
          const { master_key } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          send(conn.socket, ack(msg.req_id, { ok: true }));
          send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "sync_from_draft": {
          const { master_key, draft } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }

          state.local_room_id = draft?.local_room_id || state.local_room_id;
          state.senders = Array.isArray(draft?.senders_active) ? draft.senders_active : state.senders;
          state.reel_items = normalizeDraftReelItems(draft);

          const existingBySender = new Map<string, LobbyPlayer>();
          for (const p of state.players) if (p.sender_id_local) existingBySender.set(p.sender_id_local, p);

          for (const s of state.senders.filter((x: any) => x.active)) {
            if (!existingBySender.has(s.id_local)) {
              state.players.push({
                id: `p_${crypto.randomUUID()}`,
                type: "sender_linked",
                sender_id_local: s.id_local,
                active: true,
                name: s.name,
                original_name: s.name,
                status: "free",
                device_id: null,
                player_session_token: null,
                photo_url: null,
                last_ping_ms: null,
                afk_expires_at_ms: null
              });
            } else {
              const p = existingBySender.get(s.id_local)!;
              p.active = true;
              if (p.status === "disabled") p.status = "free";
              if (p.status === "free") p.name = s.name;
              if (!p.original_name) p.original_name = s.name;
            }
          }

          const activeSenderSet = new Set(state.senders.filter((x: any) => x.active).map((x: any) => x.id_local));
          for (const p of state.players) {
            if (p.type === "sender_linked" && p.sender_id_local && !activeSenderSet.has(p.sender_id_local)) {
              p.active = false;
              p.status = "disabled";
              p.device_id = null;
              p.player_session_token = null;
              p.last_ping_ms = null;
              p.afk_expires_at_ms = null;
            }
          }

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "play_hello": {
          const { device_id } = msg.payload || {};
          c.device_id = device_id;
          send(conn.socket, ack(msg.req_id, { ok: true }));
          send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "claim_player": {
          const { device_id, player_id } = msg.payload || {};
          const dev = String(device_id || "");
          const pid = String(player_id || "");

          const gotLock = await acquireClaimLock(join_code, pid);
          if (!gotLock) {
            send(conn.socket, err(msg.req_id, "TAKEN", "Pris à l’instant"));
            return;
          }

          try {
            const st = await getLobby(join_code);
            if (!st) {
              send(conn.socket, err(msg.req_id, "LOBBY_NOT_FOUND", "Lobby introuvable"));
              return;
            }

            const already = st.players.find(p =>
              p.active &&
              p.status !== "disabled" &&
              p.device_id === dev &&
              (p.status === "connected" || p.status === "afk")
            );
            if (already) {
              send(conn.socket, err(msg.req_id, "DOUBLE_DEVICE", "Tu as déjà un player"));
              return;
            }

            const p = st.players.find(x => x.id === pid);
            if (!p || !p.active || p.status === "disabled") {
              send(conn.socket, err(msg.req_id, "NOT_AVAILABLE", "Player indisponible"));
              return;
            }
            if (p.status !== "free") {
              send(conn.socket, err(msg.req_id, "TAKEN", "Pris à l’instant"));
              return;
            }

            p.status = "connected";
            p.device_id = dev;
            p.player_session_token = `t_${crypto.randomUUID()}`;
            p.last_ping_ms = Date.now();
            p.afk_expires_at_ms = null;

            await saveLobby(st);

            send(conn.socket, ack(msg.req_id, { ok: true, player_id: p.id, player_session_token: p.player_session_token }));
            broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(st) });
          } finally {
            await releaseClaimLock(join_code, pid);
          }
          return;
        }

        case "release_player": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const dev = String(device_id || "");
          const tok = String(player_session_token || "");

          const p = state.players.find(x => x.id === String(player_id || ""));
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== dev || p.player_session_token !== tok) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }

          releasePlayer(p);
          await saveLobby(state);

          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "ping": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const dev = String(device_id || "");
          const tok = String(player_session_token || "");

          const p = state.players.find(x => x.id === String(player_id || ""));
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== dev || p.player_session_token !== tok) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }

          p.last_ping_ms = Date.now();
          if (p.status === "afk") {
            p.status = "connected";
            p.afk_expires_at_ms = null;
            await saveLobby(state);
            broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          }

          send(conn.socket, ack(msg.req_id, { ok: true }));
          return;
        }

        case "set_player_name": {
          const { device_id, player_id, player_session_token, name } = msg.payload || {};
          const dev = String(device_id || "");
          const tok = String(player_session_token || "");

          const p = state.players.find(x => x.id === String(player_id || ""));
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== dev || p.player_session_token !== tok) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }

          p.name = String(name || p.name).slice(0, 48);

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "reset_player_name": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const dev = String(device_id || "");
          const tok = String(player_session_token || "");

          const p = state.players.find(x => x.id === String(player_id || ""));
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== dev || p.player_session_token !== tok) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }

          p.name = p.original_name || p.name;

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "start_game_request": {
          const { master_key } = msg.payload || {};
          if (String(master_key || "") !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }

          try {
            const out = await buildAndPersistRoomFromLobby(state);

            send(conn.socket, ack(msg.req_id, { ok: true, room_code: out.room_code }));

            closeLobbyWs(join_code, "start_game");
            await redis.del(`brp:lobby:${join_code}`);
          } catch (e: any) {
            const code = String(e?.message || "START_GAME_FAILED");
            const msgText =
              code === "NEED_2_SENDERS" ? "Il faut au moins 2 senders actifs" :
              code === "NEED_2_PLAYERS" ? "Il faut au moins 2 players actifs" :
              code === "NOT_ALL_CONNECTED" ? "Tous les players actifs doivent être connectés ou AFK" :
              code === "NO_REELS" ? "Aucun reel utilisable" :
              "Start game impossible";
            send(conn.socket, err(msg.req_id, code, msgText));
          }
          return;
        }

        default:
          send(conn.socket, err(msg.req_id, "UNKNOWN", "Message inconnu"));
          return;
      }
    });

    conn.socket.on("close", () => removeConn(join_code, c));

    const st = await getLobby(join_code);
    if (st) send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(st) });
    else send(conn.socket, { type: "error", ts: Date.now(), payload: { code: "LOBBY_NOT_FOUND", message: "Lobby introuvable" } });
  });
}
