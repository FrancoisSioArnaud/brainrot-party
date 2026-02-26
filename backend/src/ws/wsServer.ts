import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type {
  ClientToServerMsg,
  ServerToClientMsg,
} from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type {
  RoomStateInternal,
  GameInternal,
} from "../state/createRoom.js";
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

function buildStateSync(state: RoomStateInternal): ServerToClientMsg {
  return {
    type: "STATE_SYNC_RESPONSE",
    payload: {
      room_code: state.room_code,
      phase: state.phase,
      setup_ready: !!state.setup,
      players_visible: state.players
        .filter((p) => p.active)
        .map((p) => ({
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
  };
}

function getCurrent(state: RoomStateInternal) {
  if (!state.game || !state.setup) return null;

  const round = state.setup.rounds[state.game.current_round_index];
  if (!round) return null;

  const item = round.items[state.game.current_item_index];
  if (!item) return null;

  return { round, item };
}

function selectableSenders(state: RoomStateInternal) {
  return state.senders.filter((s) => s.active).map((s) => s.sender_id);
}

function expectedPlayers(state: RoomStateInternal) {
  return state.players
    .filter((p) => p.active && p.claimed_by)
    .map((p) => p.player_id);
}

function allVotesReceived(game: GameInternal) {
  return game.expected_player_ids.every((id) => !!game.votes[id]);
}

function computeScores(
  state: RoomStateInternal,
  true_sender_ids: string[]
) {
  if (!state.game) return;

  for (const pid of state.game.expected_player_ids) {
    const vote = state.game.votes[pid] || [];
    const correct = vote.filter((s) =>
      true_sender_ids.includes(s)
    ).length;

    state.scores[pid] = (state.scores[pid] ?? 0) + correct;
  }
}

export async function registerWs(
  app: FastifyInstance,
  repo: RoomRepo
) {
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

        send(ws, buildStateSync(loaded.state));
        return;
      }

      const room_code = ctx.room_code!;
      const loaded = await loadRoom(repo, room_code);
      if (!loaded) return;

      const state = loaded.state;

      /* ---------------- START GAME ---------------- */

      if (msg.type === "START_GAME") {
        if (!ctx.is_master) return;
        if (state.phase !== "lobby") return;
        if (!state.setup) return;

        state.phase = "game";
        state.game = {
          current_round_index: 0,
          current_item_index: 0,
          status: "reveal",
          expected_player_ids: [],
          votes: {},
          round_finished: false,
        };

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "GAME_START",
          payload: { room_code },
        });

        const { round, item } = getCurrent(state)!;

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

      /* ---------------- REEL OPENED ---------------- */

      if (msg.type === "REEL_OPENED") {
        if (!ctx.is_master) return;
        if (!state.game) return;
        if (state.game.status !== "reveal") return;

        const current = getCurrent(state);
        if (!current) return;

        state.game.status = "vote";
        state.game.expected_player_ids =
          expectedPlayers(state);
        state.game.votes = {};

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "START_VOTE",
          payload: {
            room_code,
            round_id: current.round.round_id,
            item_id: current.item.item_id,
            senders_selectable: selectableSenders(state),
            k: current.item.k,
          },
        });

        return;
      }

      /* ---------------- SUBMIT VOTE ---------------- */

      if (msg.type === "SUBMIT_VOTE") {
        if (!state.game) return;
        if (state.game.status !== "vote") return;
        if (!ctx.my_player_id) return;

        const current = getCurrent(state);
        if (!current) return;

        const { selections } = msg.payload;

        if (selections.length !== current.item.k) return;

        state.game.votes[ctx.my_player_id] = selections;

        await repo.setState(room_code, state);

        send(ws, {
          type: "VOTE_ACK",
          payload: {
            room_code,
            round_id: current.round.round_id,
            item_id: current.item.item_id,
          },
        });

        broadcast(room_code, {
          type: "PLAYER_VOTED",
          payload: {
            room_code,
            player_id: ctx.my_player_id,
          },
        });

        if (allVotesReceived(state.game)) {
          computeScores(
            state,
            current.item.true_sender_ids
          );

          state.game.status = "reveal_wait";

          await repo.setState(room_code, state);

          broadcast(room_code, {
            type: "VOTE_RESULTS",
            payload: {
              room_code,
              round_id: current.round.round_id,
              item_id: current.item.item_id,
              votes: state.game.votes,
              true_sender_ids:
                current.item.true_sender_ids,
              scores: state.scores,
            },
          });
        }

        return;
      }

      /* ---------------- END ITEM ---------------- */

      if (msg.type === "END_ITEM") {
        if (!ctx.is_master) return;
        if (!state.game) return;
        if (state.game.status !== "reveal_wait")
          return;

        const current = getCurrent(state);
        if (!current) return;

        state.game.current_item_index++;

        const round =
          state.setup!.rounds[
            state.game.current_round_index
          ];

        if (
          state.game.current_item_index <
          round.items.length
        ) {
          state.game.status = "reveal";
          state.game.votes = {};
          state.game.expected_player_ids = [];

          await repo.setState(room_code, state);

          const next =
            round.items[state.game.current_item_index];

          broadcast(room_code, {
            type: "NEW_ITEM",
            payload: {
              room_code,
              round_id: round.round_id,
              item_id: next.item_id,
            },
          });
        } else {
          state.game.status = "round_recap";
          state.game.round_finished = true;

          await repo.setState(room_code, state);

          broadcast(room_code, {
            type: "ROUND_RECAP",
            payload: {
              room_code,
              round_id: round.round_id,
              scores: state.scores,
            },
          });
        }

        return;
      }

      /* ---------------- START NEXT ROUND ---------------- */

      if (msg.type === "START_NEXT_ROUND") {
        if (!ctx.is_master) return;
        if (!state.game) return;
        if (!state.game.round_finished) return;

        state.game.current_round_index++;
        state.game.current_item_index = 0;
        state.game.round_finished = false;
        state.game.votes = {};
        state.game.expected_player_ids = [];

        if (
          state.game.current_round_index >=
          state.setup!.rounds.length
        ) {
          state.phase = "game_over";

          await repo.setState(room_code, state);

          broadcast(room_code, {
            type: "GAME_OVER",
            payload: {
              room_code,
              scores: state.scores,
            },
          });

          return;
        }

        state.game.status = "reveal";

        await repo.setState(room_code, state);

        const round =
          state.setup!.rounds[
            state.game.current_round_index
          ];

        broadcast(room_code, {
          type: "ROUND_FINISHED",
          payload: {
            room_code,
            round_id: round.round_id,
          },
        });

        broadcast(room_code, {
          type: "NEW_ITEM",
          payload: {
            room_code,
            round_id: round.round_id,
            item_id: round.items[0].item_id,
          },
        });

        return;
      }

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildStateSync(state));
        return;
      }
    });

    ws.on("close", () => {
      if (!ctx.room_code) return;
      roomLeave(ctx.room_code, ctx);
    });
  });
}
