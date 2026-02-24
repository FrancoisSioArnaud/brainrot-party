import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ServerToClientMsg, ClientToServerMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import { sha256Hex } from "../utils/hash.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type { RoomStateInternal } from "../state/createRoom.js";
import { logger } from "../logger.js";

type RoomSockets = Map<string, Set<WebSocket>>;
const rooms: RoomSockets = new Map();

function roomJoin(room_code: string, ws: WebSocket) {
  if (!rooms.has(room_code)) rooms.set(room_code, new Set());
  rooms.get(room_code)!.add(ws);
}
function roomLeave(room_code: string, ws: WebSocket) {
  rooms.get(room_code)?.delete(ws);
  if (rooms.get(room_code)?.size === 0) rooms.delete(room_code);
}

function send(ws: WebSocket, msg: ServerToClientMsg) {
  ws.send(JSON.stringify(msg));
}

function errorMsg(room_code: string | undefined, error: any, message?: string): ServerToClientMsg {
  return {
    type: "ERROR",
    payload: {
      room_code,
      error,
      message,
    },
  };
}

function buildStateSync(state: RoomStateInternal, is_master: boolean, my_player_id: string | null) {
  const players_visible = state.players.map((p) => ({
    player_id: p.player_id,
    sender_id: p.sender_id,
    is_sender_bound: p.is_sender_bound,
    active: p.active,
    status: p.claimed_by ? "taken" : "free",
    name: p.name,
    avatar_url: p.avatar_url,
  }));

  const senders_visible = state.senders.map((s) => ({
    sender_id: s.sender_id,
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  return {
    type: "STATE_SYNC_RESPONSE",
    payload: {
      room_code: state.room_code,
      phase: state.phase,
      players_visible,
      senders_visible,
      players_all: is_master ? state.players : undefined,
      senders_all: is_master ? state.senders : undefined,
      my_player_id,
      game: null,
      scores: state.scores,
    },
  } as const;
}

export async function registerWs(app: FastifyInstance, repo: RoomRepo) {
  await app.register(websocketPlugin);

  app.get("/ws", { websocket: true }, (conn /* SocketStream */, req) => {
    const ws = conn.socket as WebSocket;

    const ctx = {
      ws,
      room_code: null,
      device_id: null,
      is_master: false,
      my_player_id: null,
    };

    ws.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        send(ws, errorMsg(undefined, "invalid_payload", "Invalid JSON"));
        return;
      }

      if (!isClientToServerMsg(parsed)) {
        send(ws, errorMsg(ctx.room_code ?? undefined, "invalid_payload", "Unknown message type"));
        return;
      }

      const msg = parsed as ClientToServerMsg;

      // Must JOIN first
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

        // Touch TTL on join
        await repo.touch(room_code);

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

        roomJoin(room_code, ws);

        logger.info({ room_code, device_id, is_master }, "JOIN_ROOM");

        send(ws, {
          type: "JOIN_OK",
          payload: { room_code, phase: state.phase, protocol_version: PROTOCOL_VERSION },
        });

        send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
        return;
      }

      // After join: minimal supported messages (REQUEST_SYNC only for now)
      const room_code = ctx.room_code;
      const loaded = await loadRoom(repo, room_code);
      if (!loaded) {
        send(ws, errorMsg(room_code, "room_expired", "Room expired"));
        return;
      }
      await repo.touch(room_code);

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildStateSync(loaded.state, ctx.is_master, ctx.my_player_id));
        return;
      }

      // For now, everything else is not implemented in foundation phase
      send(ws, errorMsg(room_code, "invalid_state", "Message not implemented yet"));
    });

    ws.on("close", () => {
      if (ctx.room_code) roomLeave(ctx.room_code, ws);
    });
  });
}
