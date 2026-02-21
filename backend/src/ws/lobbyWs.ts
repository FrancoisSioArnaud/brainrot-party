import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { ack, err, WSMsg } from "./protocol";
import { getLobby, saveLobby, deleteLobby, LobbyState, LobbyPlayer } from "../state/lobbyStore";
import { redis } from "../state/redis";
import { saveGame } from "../state/gameStore";

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

/**
 * ✅ Close lobby and include room_code for Play/Master navigation
 */
export function closeLobbyWs(
  join_code: string,
  reason: "reset" | "start_game" | "unknown" = "unknown",
  room_code: string | null = null
) {
  broadcast(join_code, {
    type: "lobby_closed",
    ts: Date.now(),
    payload: { reason, room_code }
  });

  const conns = lobbyConnections.get(join_code);
  if (conns) {
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
  }
  lobbyConnections.delete(join_code);
  stopTicker(join_code);
}

function safeJoinCode(x: string) {
  return x.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
}

function computeReadyToStart(st: LobbyState) {
  const active = st.players.filter(p => p.active && p.status !== "disabled");
  if (active.length < 2) return { ok: false, code: "NEED_2_PLAYERS" as const };
  const allConnectedOrAfk = active.every(p => p.status === "connected" || p.status === "afk");
  if (!allConnectedOrAfk) return { ok: false, code: "NOT_ALL_CONNECTED" as const };
  return { ok: true as const };
}

function buildMinimalGameStateFromLobby(st: LobbyState, room_code: string) {
  const now = Date.now();

  const senders = (st.senders || [])
    .filter((s: any) => s.active)
    .map((s: any) => ({
      id: s.id_local,
      name: s.name,
      photo_url: null,
      active: true
    }));

  const players = (st.players || [])
    .filter(p => p.active && p.status !== "disabled")
    .map(p => ({
      id: p.id,
      name: p.name,
      photo_url: p.photo_url || null,
      active: true,
      score: 0,
      connected: p.status === "connected" || p.status === "afk"
    }));

  return {
    room: {
      room_code,
      status: "IN_GAME",
      phase: "ROUND_INIT",
      current_round_index: 0,
      current_item_index: 0,
      timer_end_ts: null
    },
    senders,
    players,
    round: {
      items_ordered: [],
      focus_item_id: null
    },
    ui_state: {
      remaining_sender_ids: [],
      revealed_slots_by_item: {},
      current_votes_by_player: {},
      reel_urls_by_item: {}
    },
    created_at: now
  };
}

export async function registerLobbyWS(app: FastifyInstance) {
  app.get("/ws/lobby/:joinCode", { websocket: true }, async (conn, req) => {
    const join_code = safeJoinCode(String((req.params as any).joinCode || ""));
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

          const existingBySender = new Map<string, LobbyPlayer>();
          for (const p of state.players) if (p.sender_id_local) existingBySender.set(p.sender_id_local, p);

          // ensure 1 player per active sender
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

          // disable players whose sender is no longer active
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

        case "create_manual_player": {
          const { master_key, name } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          const nm = String(name || "Player").slice(0, 48);
          state.players.push({
            id: `p_${crypto.randomUUID()}`,
            type: "manual",
            sender_id_local: null,
            active: true,
            name: nm,
            original_name: nm,
            status: "free",
            device_id: null,
            player_session_token: null,
            photo_url: null,
            last_ping_ms: null,
            afk_expires_at_ms: null
          });

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "delete_player": {
          const { master_key, player_id } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }

          const pid = String(player_id || "");
          const p = state.players.find(x => x.id === pid);
          if (!p) {
            send(conn.socket, ack(msg.req_id, { ok: true }));
            return;
          }
          if (p.type !== "manual") {
            send(conn.socket, err(msg.req_id, "FORBIDDEN", "Player auto non supprimable"));
            return;
          }

          // kick if connected
          if (p.device_id) {
            broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { reason: "deleted", player_id: p.id } });
          }

          state.players = state.players.filter(x => x.id !== pid);
          await saveLobby(state);

          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "set_player_active": {
          const { master_key, player_id, active } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }

          const pid = String(player_id || "");
          const p = state.players.find(x => x.id === pid);
          if (!p) {
            send(conn.socket, ack(msg.req_id, { ok: true }));
            return;
          }

          if (p.type !== "sender_linked") {
            send(conn.socket, err(msg.req_id, "FORBIDDEN", "Player manuel non désactivable séparément"));
            return;
          }

          const isActive = !!active;
          p.active = isActive;
          if (!isActive) {
            if (p.device_id) {
              broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { reason: "disabled", player_id: p.id } });
            }
            p.status = "disabled";
            p.device_id = null;
            p.player_session_token = null;
            p.last_ping_ms = null;
            p.afk_expires_at_ms = null;
          } else {
            if (p.status === "disabled") p.status = "free";
          }

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "play_hello": {
          const { device_id } = msg.payload || {};
          c.device_id = String(device_id || "");
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

            send(conn.socket, ack(msg.req_id, {
              ok: true,
              player_id: p.id,
              player_session_token: p.player_session_token
            }));
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

        /**
         * ✅ REAL start game (MVP)
         * - Validate master_key
         * - Validate ready conditions
         * - Create minimal game state in Redis (Game WS can state_sync)
         * - Close lobby with room_code
         * - Delete lobby store
         */
        case "start_game_request": {
          const { master_key } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }

          const ok = computeReadyToStart(state);
          if (!ok.ok) {
            send(conn.socket, err(msg.req_id, ok.code, "Start game bloqué (players pas prêts)"));
            return;
          }

          const room_code = state.join_code; // MVP: room_code = join_code
          const gamePayload = buildMinimalGameStateFromLobby(state, room_code);

          await saveGame({
            room_code,
            master_key: state.master_key,
            phase: "IN_GAME",
            timer_end_ts: null
          });

          // also store the richer payload for state_sync (gameWs reads getGame only,
          // but your frontend expects richer payload; we keep it in redis alongside if you want later)
          try {
            await redis.set(`brp:game_state_sync:${room_code}`, JSON.stringify(gamePayload), "EX", 60 * 60 * 6);
          } catch {}

          send(conn.socket, ack(msg.req_id, { ok: true, room_code }));

          closeLobbyWs(join_code, "start_game", room_code);
          await deleteLobby(join_code);

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
