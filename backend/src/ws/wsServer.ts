import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import { sha256Hex } from "../utils/hash.js";
import { genManualPlayerId } from "../utils/ids.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type { RoomStateInternal } from "../state/createRoom.js";
import { ClaimRepo } from "../state/claimRepo.js";
import type { ConnCtx } from "./wsTypes.js";

type RoomConnections = Map<string, Set<ConnCtx>>;
const rooms: RoomConnections = new Map();

function roomJoin(room_code: string, ctx: ConnCtx) {
  if (!rooms.has(room_code)) rooms.set(room_code, new Set());
  rooms.get(room_code)!.add(ctx);
}

function roomLeave(room_code: string, ctx: ConnCtx) {
  rooms.get(room_code)?.delete(ctx);
  if (rooms.get(room_code)?.size === 0) rooms.delete(room_code);
}

function send(ws: WebSocket, msg: ServerToClientMsg) {
  ws.send(JSON.stringify(msg));
}

function errorMsg(
  room_code: string | undefined,
  error: any,
  message?: string,
  details?: Record<string, unknown>
): ServerToClientMsg {
  return { type: "ERROR", payload: { room_code, error, message, details } };
}

function buildStateSync(state: RoomStateInternal, is_master: boolean, my_player_id: string | null): ServerToClientMsg {
  const setup_ready = state.setup !== null;

  const players_visible = state.players
    .filter((p) => p.active)
    .map((p) => ({
      player_id: p.player_id,
      sender_id: p.sender_id ?? null,
      is_sender_bound: p.is_sender_bound,
      active: p.active,
      status: p.claimed_by ? ("taken" as const) : ("free" as const),
      name: p.name,
      avatar_url: p.avatar_url,
    }));

  // Play UI does not display senders. Keep master-only senders lists.
  const senders_visible = is_master
    ? state.senders
        .filter((s) => s.active)
        .map((s) => ({
          sender_id: s.sender_id,
          name: s.name,
          active: s.active,
          reels_count: s.reels_count,
        }))
    : [];

  return {
    type: "STATE_SYNC_RESPONSE",
    payload: {
      room_code: state.room_code,
      phase: state.phase,
      setup_ready,
      players_visible,
      senders_visible,
      players_all: is_master ? state.players : undefined,
      senders_all: is_master ? state.senders : undefined,
      my_player_id,
      game: null,
      scores: state.scores,
    },
  };
}

async function broadcastState(repo: RoomRepo, room_code: string) {
  const loaded = await loadRoom(repo, room_code);
  if (!loaded) return;

  const conns = rooms.get(room_code);
  if (!conns) return;

  for (const c of conns) {
    send(c.ws, buildStateSync(loaded.state, c.is_master, c.my_player_id));
  }
}

export async function registerWs(app: FastifyInstance, repo: RoomRepo) {
  await app.register(websocketPlugin);

  const claimRepo = new ClaimRepo(repo.redis);

  app.get("/ws", { websocket: true }, (conn: any, _req) => {
    const ws = (conn?.socket ?? conn) as WebSocket;

    const ctx: ConnCtx = {
      ws,
      room_code: null,
      device_id: null,
      is_master: false,
      my_player_id: null,
    };

    ws.on("message", async (raw: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(ws, errorMsg(undefined, "invalid_payload", "Invalid JSON"));
        return;
      }

      if (!isClientToServerMsg(parsed)) {
        send(ws, errorMsg(ctx.room_code ?? undefined, "invalid_payload", "Unknown message type"));
        return;
      }

      const msg = parsed as ClientToServerMsg;

      // JOIN must be first
      if (!ctx.room_code) {
        if (msg.type !== "JOIN_ROOM") {
          send(ws, errorMsg(undefined, "forbidden", "Must JOIN_ROOM first"));
          return;
        }

        const { room_code, device_id, protocol_version, master_key } = msg.payload;

        if (protocol_version !== PROTOCOL_VERSION) {
          send(ws, errorMsg(room_code, "invalid_protocol_version", "Protocol version mismatch"));
          return;
        }

        const loaded = await loadRoom(repo, room_code);
        if (!loaded) {
          send(ws, errorMsg(room_code, "room_not_found", "Room not found"));
          return;
        }

        await repo.touchRoomAll(room_code);

        const { meta, state } = loaded;

        let is_master = false;
        if (master_key) {
          is_master = sha256Hex(master_key) === meta.master_hash;
          if (!is_master) {
            send(ws, errorMsg(room_code, "forbidden", "Invalid master key"));
            return;
          }
        }

        ctx.room_code = room_code;
        ctx.device_id = device_id;
        ctx.is_master = is_master;

        const existing = await claimRepo.getPlayerForDevice(room_code, device_id);
        if (existing) ctx.my_player_id = existing;

        roomJoin(room_code, ctx);

        app.log.info({ room_code, device_id, is_master }, "JOIN_ROOM");

        send(ws, {
          type: "JOIN_OK",
          payload: { room_code, phase: state.phase, protocol_version: PROTOCOL_VERSION },
        });

        send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
        return;
      }

      const room_code = ctx.room_code!;
      const device_id = ctx.device_id!;

      const loaded = await loadRoom(repo, room_code);
      if (!loaded) {
        send(ws, errorMsg(room_code, "room_expired", "Room expired"));
        return;
      }

      await repo.touchRoomAll(room_code);
      const state = loaded.state;

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
        return;
      }

      if (msg.type === "RESET_CLAIMS") {
        if (!ctx.is_master) {
          send(ws, errorMsg(room_code, "not_master", "Master only"));
          return;
        }
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        await claimRepo.delClaims(room_code);
        for (const p of state.players) p.claimed_by = undefined;

        const conns = rooms.get(room_code);
        if (conns) {
          for (const c of conns) {
            if (!c.is_master && c.my_player_id) {
              const old = c.my_player_id;
              c.my_player_id = null;
              send(c.ws, {
                type: "SLOT_INVALIDATED",
                payload: { room_code, player_id: old, reason: "reset_by_master" },
              });
            }
          }
        }

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "RELEASE_PLAYER") {
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        if (!ctx.my_player_id) {
          // No-op but deterministic: send state sync back
          send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
          return;
        }

        // Release claim in redis (device -> player + player -> device)
        await claimRepo.releaseByDevice(room_code, device_id);

        // Clear claim in room state
        const pid = ctx.my_player_id;
        const p = state.players.find((x) => x.player_id === pid);
        if (p && p.claimed_by === device_id) {
          p.claimed_by = undefined;
        }

        ctx.my_player_id = null;

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "TAKE_PLAYER") {
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        if (!state.setup || state.players.length === 0) {
          send(ws, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "setup_not_ready" },
          });
          return;
        }

        const { player_id } = msg.payload;
        const p = state.players.find((x) => x.player_id === player_id);

        const claim = await claimRepo.claim(room_code, device_id, player_id, !!p, !!p?.active);
        if (!claim.ok) {
          send(ws, {
            type: "TAKE_PLAYER_FAIL",
            payload: {
              room_code,
              player_id,
              reason:
                claim.reason === "device_already_has_player"
                  ? "device_already_has_player"
                  : claim.reason === "inactive"
                    ? "inactive"
                    : claim.reason === "player_not_found"
                      ? "player_not_found"
                      : "taken_now",
            },
          });
          return;
        }

        p!.claimed_by = device_id;
        ctx.my_player_id = player_id;

        await repo.setState(room_code, state);

        send(ws, { type: "TAKE_PLAYER_OK", payload: { room_code, my_player_id: player_id } });
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "RENAME_PLAYER") {
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }
        if (!ctx.my_player_id) {
          send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));
          return;
        }

        const name = msg.payload.new_name.trim();
        if (name.length < 1 || name.length > 24) {
          send(ws, errorMsg(room_code, "invalid_payload", "Invalid name length", { min: 1, max: 24 }));
          return;
        }

        const p = state.players.find((x) => x.player_id === ctx.my_player_id);
        if (!p) {
          ctx.my_player_id = null;
          send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
          return;
        }
        if (p.claimed_by !== device_id) {
          ctx.my_player_id = null;
          send(ws, errorMsg(room_code, "not_claimed", "Claim mismatch"));
          return;
        }

        p.name = name;

        // If sender-bound, keep a single source of truth: rename sender too.
        if (p.is_sender_bound && p.sender_id) {
          const s = state.senders.find((x) => x.sender_id === p.sender_id);
          if (s) s.name = name;
        }

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "ADD_PLAYER") {
        if (!ctx.is_master) {
          send(ws, errorMsg(room_code, "not_master", "Master only"));
          return;
        }
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        const rawName = typeof (msg.payload as any).name === "string" ? (msg.payload as any).name.trim() : "";
        const name = rawName ? rawName : "Player";
        if (name.length < 1 || name.length > 24) {
          send(ws, errorMsg(room_code, "invalid_payload", "Invalid name length", { min: 1, max: 24 }));
          return;
        }

        const player_id = genManualPlayerId();
        state.players.push({
          player_id,
          sender_id: null,
          is_sender_bound: false,
          active: true,
          name,
          avatar_url: null,
        });
        state.scores[player_id] = 0;

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "DELETE_PLAYER") {
        if (!ctx.is_master) {
          send(ws, errorMsg(room_code, "not_master", "Master only"));
          return;
        }
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        const { player_id } = msg.payload as any;
        if (typeof player_id !== "string" || !player_id) {
          send(ws, errorMsg(room_code, "invalid_payload", "Missing player_id"));
          return;
        }

        const idx = state.players.findIndex((p) => p.player_id === player_id);
        if (idx === -1) {
          send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
          return;
        }

        const p = state.players[idx];
        if (p.is_sender_bound) {
          send(ws, errorMsg(room_code, "validation_error:player_not_manual", "Only manual players can be deleted"));
          return;
        }

        // If claimed: release + invalidate the claiming device.
        if (p.claimed_by) {
          const claimedDevice = p.claimed_by;
          await claimRepo.releaseByPlayer(room_code, player_id);

          const conns = rooms.get(room_code);
          if (conns) {
            for (const c of conns) {
              if (c.device_id === claimedDevice) {
                c.my_player_id = null;
                send(c.ws, {
                  type: "SLOT_INVALIDATED",
                  payload: { room_code, player_id, reason: "disabled_or_deleted" },
                });
              }
            }
          }
        }

        state.players.splice(idx, 1);
        delete state.scores[player_id];

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      if (msg.type === "TOGGLE_PLAYER") {
        if (!ctx.is_master) {
          send(ws, errorMsg(room_code, "not_master", "Master only"));
          return;
        }
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        const { player_id, active } = msg.payload;
        const p = state.players.find((x) => x.player_id === player_id);
        if (!p) {
          send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
          return;
        }

        p.active = active;

        if (!active && p.claimed_by) {
          const claimedDevice = p.claimed_by;

          await claimRepo.releaseByPlayer(room_code, player_id);
          p.claimed_by = undefined;

          const conns = rooms.get(room_code);
          if (conns) {
            for (const c of conns) {
              if (c.device_id === claimedDevice) {
                c.my_player_id = null;
                send(c.ws, {
                  type: "SLOT_INVALIDATED",
                  payload: { room_code, player_id, reason: "disabled_or_deleted" },
                });
              }
            }
          }
        }

        await repo.setState(room_code, state);
        await broadcastState(repo, room_code);
        return;
      }

      send(ws, errorMsg(room_code, "invalid_state", "Message not implemented yet"));
    });

    ws.on("close", () => {
      if (!ctx.room_code) return;
      roomLeave(ctx.room_code, ctx);
    });
  });
}
