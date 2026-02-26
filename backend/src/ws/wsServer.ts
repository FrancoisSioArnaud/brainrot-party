import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type { RoomStateInternal } from "../state/createRoom.js";
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

function broadcast(room_code: string, msg: ServerToClientMsg) {
  const conns = rooms.get(room_code);
  if (!conns) return;
  for (const c of conns) send(c.ws, msg);
}

function buildGameSync(state: RoomStateInternal) {
  return {
    type: "STATE_SYNC_RESPONSE",
    payload: {
      room_code: state.room_code,
      phase: state.phase,
      setup_ready: !!state.setup,
      players_visible: state.players.filter((p) => p.active).map((p) => ({
        player_id: p.player_id,
        sender_id: p.sender_id,
        is_sender_bound: p.is_sender_bound,
        active: p.active,
        status: p.claimed_by ? "taken" : "free",
        name: p.name,
        avatar_url: p.avatar_url ?? null,
      })),
      senders_visible: state.senders.filter((s) => s.active),
      players_all: state.players,
      senders_all: state.senders,
      my_player_id: null,
      game: state.game,
      scores: state.scores,
    },
  } as ServerToClientMsg;
}

export async function registerWs(app: FastifyInstance, repo: RoomRepo) {
  await app.register(websocketPlugin);

  app.get("/ws", { websocket: true }, (conn: any) => {
    const ws = conn.socket as WebSocket;

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
        return;
      }

      if (!isClientToServerMsg(parsed)) return;

      const msg = parsed as ClientToServerMsg;

      if (!ctx.room_code) {
        if (msg.type !== "JOIN_ROOM") return;

        const loaded = await loadRoom(repo, msg.payload.room_code);
        if (!loaded) return;

        ctx.room_code = msg.payload.room_code;
        ctx.device_id = msg.payload.device_id;
        ctx.is_master = !!msg.payload.master_key;

        roomJoin(ctx.room_code, ctx);

        send(ws, {
          type: "JOIN_OK",
          payload: {
            room_code: ctx.room_code,
            phase: loaded.state.phase,
            protocol_version: PROTOCOL_VERSION,
          },
        });

        send(ws, buildGameSync(loaded.state));
        return;
      }

      const room_code = ctx.room_code!;
      const loaded = await loadRoom(repo, room_code);
      if (!loaded) return;

      const state = loaded.state;

      if (msg.type === "START_GAME") {
        if (!ctx.is_master) return;
        if (state.phase !== "lobby") return;
        if (!state.setup) return;

        state.phase = "game";
        state.game = {
          current_round_index: 0,
          current_item_index: 0,
          status: "idle",
          expected_player_ids: [],
          votes: {},
        };

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "GAME_START",
          payload: { room_code },
        });

        const round = state.setup.rounds[0];
        const item = round.items[0];

        state.game.status = "reveal";

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "NEW_ITEM",
          payload: {
            room_code,
            round_id: round.round_id,
            item_id: item.item_id,
          },
        });

        return;
      }

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildGameSync(state));
        return;
      }
    });

    ws.on("close", () => {
      if (!ctx.room_code) return;
      roomLeave(ctx.room_code, ctx);
    });
  });
}
