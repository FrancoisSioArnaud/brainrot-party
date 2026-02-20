import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { ack, err, WSMsg } from "./protocol";
import { getLobby, saveLobby, LobbyState, LobbyPlayer } from "../state/lobbyStore";

type Conn = { ws: WebSocket; role: "master" | "play"; device_id?: string };

const lobbyConnections = new Map<string, Set<Conn>>(); // join_code -> conns
const lobbyIntervals = new Map<string, NodeJS.Timeout>();

// Spec settings
const PING_TIMEOUT_MS = 30_000; // 30s sans ping => AFK
const AFK_GRACE_MS = 15_000;    // AFK countdown (à 0 => libération)
const TICK_MS = 1_000;

function broadcast(join_code: string, msg: any) {
  const conns = lobbyConnections.get(join_code);
  if (!conns) return;
  for (const c of conns) {
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {}
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

    // Connected -> AFK if ping timeout
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

    // AFK countdown -> release at 0
    if (p.status === "afk" && p.afk_expires_at_ms) {
      const secondsLeft = Math.max(0, Math.ceil((p.afk_expires_at_ms - now) / 1000));

      // Emit countdown updates (cheap, once per tick)
      broadcast(join_code, {
        type: "player_afk",
        ts: now,
        payload: { player_id: p.id, seconds_left: secondsLeft }
      });

      if (now >= p.afk_expires_at_ms) {
        const releasedPlayerId = p.id;
        releasePlayer(p);
        changed = true;

        broadcast(join_code, {
          type: "player_released",
          ts: now,
          payload: { player_id: releasedPlayerId }
        });
      }
    }
  }

  if (changed) {
    await saveLobby(state);
    broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
  }
}

/**
 * Utilisé par HTTP routes (reset / start_game)
 * - broadcast lobby_closed
 * - ferme les sockets WS
 * - purge la map de connections
 */
export function closeLobbyWs(join_code: string, reason: "reset" | "start_game" | "unknown" = "unknown") {
  const payload = { reason };
  broadcast(join_code, { type: "lobby_closed", ts: Date.now(), payload });

  const conns = lobbyConnections.get(join_code);
  if (conns) {
    for (const c of conns) {
      try {
        c.ws.close();
      } catch {}
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
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
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

          for (const s of state.senders.filter((x: any) => x.active)) {
            if (!existingBySender.has(s.id_local)) {
              state.players.push({
                id: `p_${crypto.randomUUID()}`,
                type: "sender_linked",
                sender_id_local: s.id_local,
                active: true,
                name: s.name,
                status: "free",
                device_id: null,
                player_session_token: null,
                photo_url: null,
                last_ping_ms: null,
                afk_expires_at_ms: null
              });
            } else {
              const p = existingBySender.get(s.id_local)!;
              p.name = s.name;
              p.active = true;
              if (p.status === "disabled") p.status = "free";
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

        case "create_manual_player": {
          const { master_key, name } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          state.players.push({
            id: `p_${crypto.randomUUID()}`,
            type: "manual",
            sender_id_local: null,
            active: true,
            name: String(name || "Player"),
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
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.type !== "manual") {
            send(conn.socket, err(msg.req_id, "NOT_ALLOWED", "Impossible de supprimer un player lié à un sender"));
            return;
          }
          broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { player_id, message: "Player supprimé" } });
          state.players = state.players.filter(x => x.id !== player_id);
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
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.type === "manual") {
            send(conn.socket, err(msg.req_id, "NOT_ALLOWED", "Les players manuels ne se désactivent pas (supprime-le)"));
            return;
          }

          p.active = Boolean(active);
          if (!p.active) {
            p.status = "disabled";
            p.device_id = null;
            p.player_session_token = null;
            p.last_ping_ms = null;
            p.afk_expires_at_ms = null;
            broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { player_id, message: "Player désactivé" } });
          } else {
            releasePlayer(p);
          }

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "claim_player": {
          const { device_id, player_id } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p || !p.active || p.status === "disabled") {
            send(conn.socket, err(msg.req_id, "NOT_AVAILABLE", "Player indisponible"));
            return;
          }
          if (p.status !== "free") {
            send(conn.socket, err(msg.req_id, "TAKEN", "Player déjà pris"));
            return;
          }
          p.status = "connected";
          p.device_id = String(device_id || "");
          p.player_session_token = `t_${crypto.randomUUID()}`;
          p.last_ping_ms = Date.now();
          p.afk_expires_at_ms = null;

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });

          broadcast(join_code, {
            type: "player_claimed",
            ts: Date.now(),
            payload: { player_id: p.id, device_id: p.device_id, player_session_token: p.player_session_token }
          });
          return;
        }

        case "release_player": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
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
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
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
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }
          p.name = String(name || p.name).slice(0, 48);
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "start_game_request": {
          send(conn.socket, err(msg.req_id, "NOT_IMPLEMENTED", "Start game pas encore implémenté"));
          return;
        }

        default:
          send(conn.socket, err(msg.req_id, "UNKNOWN", "Message inconnu"));
          return;
      }
    });

    conn.socket.on("close", () => {
      removeConn(join_code, c);
    });

    const st = await getLobby(join_code);
    if (st) {
      send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(st) });
    } else {
      send(conn.socket, { type: "error", ts: Date.now(), payload: { code: "LOBBY_NOT_FOUND", message: "Lobby introuvable" } });
    }
  });
}
