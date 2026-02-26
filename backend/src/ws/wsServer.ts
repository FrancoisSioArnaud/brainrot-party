import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { PlayerId, SenderId } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import { sha256Hex } from "../utils/hash.js";
import { genManualPlayerId } from "../utils/ids.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type { RoomStateInternal, GameInternal } from "../state/createRoom.js";
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

function broadcast(room_code: string, msg: ServerToClientMsg) {
  const conns = rooms.get(room_code);
  if (!conns) return;
  for (const c of conns) send(c.ws, msg);
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
          status: p.claimed_by ? ("taken" as const) : ("free" as const),
          name: p.name,
          avatar_url: p.avatar_url ?? null,
        })),

      senders_visible: state.senders
        .filter((s) => s.active)
        .map((s) => ({
          sender_id: s.sender_id,
          name: s.name,
          active: s.active,
          reels_count: s.reels_count,
        })),

      players_all: is_master ? state.players : undefined,
      senders_all: is_master ? state.senders : undefined,

      my_player_id,

      game: state.game,
      scores: state.scores,
    },
  };
}

function broadcastState(state: RoomStateInternal, room_code: string) {
  const conns = rooms.get(room_code);
  if (!conns) return;
  for (const c of conns) {
    send(c.ws, buildStateSync(state, c.is_master, c.my_player_id));
  }
}

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function pickUniqueName(desired: string, existing: string[]): string {
  const base = normalizeName(desired);
  const existingSet = new Set(existing.map((n) => normalizeName(n).toLowerCase()));
  if (!existingSet.has(base.toLowerCase())) return base;

  for (let i = 2; i < 1000; i++) {
    const c = `${base} ${i}`;
    if (!existingSet.has(c.toLowerCase())) return c;
  }
  return `${base} ${Date.now()}`;
}

function parseJpegDataUrl(input: string): { ok: true } | { ok: false; reason: string } {
  if (typeof input !== "string") return { ok: false, reason: "not_string" };

  const prefix1 = "data:image/jpeg;base64,";
  const prefix2 = "data:image/jpg;base64,";
  const prefix = input.startsWith(prefix1) ? prefix1 : input.startsWith(prefix2) ? prefix2 : null;
  if (!prefix) return { ok: false, reason: "invalid_prefix" };

  const b64 = input.slice(prefix.length);
  if (b64.length < 16) return { ok: false, reason: "too_small" };
  if (b64.length > 300_000) return { ok: false, reason: "too_large" };
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return { ok: false, reason: "invalid_base64" };

  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 4) return { ok: false, reason: "invalid_jpeg" };
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return { ok: false, reason: "invalid_jpeg" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }
}

/* ---------------- Game helpers ---------------- */

function getCurrent(state: RoomStateInternal) {
  if (!state.game || !state.setup) return null;

  const round = state.setup.rounds[state.game.current_round_index];
  if (!round) return null;

  const item = round.items[state.game.current_item_index];
  if (!item) return null;

  return { round, item };
}

function selectableSenders(state: RoomStateInternal): SenderId[] {
  return state.senders.filter((s) => s.active).map((s) => s.sender_id);
}

function expectedPlayersSnapshot(state: RoomStateInternal): PlayerId[] {
  return state.players.filter((p) => p.active && !!p.claimed_by).map((p) => p.player_id);
}

function allVotesReceived(game: GameInternal) {
  return game.expected_player_ids.every((id) => !!game.votes[id]);
}

function computeScores(state: RoomStateInternal, true_sender_ids: SenderId[]) {
  if (!state.game) return;

  for (const pid of state.game.expected_player_ids) {
    const vote = state.game.votes[pid] || [];
    const correct = vote.filter((s) => true_sender_ids.includes(s)).length;
    state.scores[pid] = (state.scores[pid] ?? 0) + correct;
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
        send(ws, errorMsg(ctx.room_code ?? undefined, "invalid_payload", "Invalid JSON"));
        return;
      }

      if (!isClientToServerMsg(parsed)) {
        send(ws, errorMsg(ctx.room_code ?? undefined, "invalid_payload", "Unknown message type"));
        return;
      }

      const msg = parsed as ClientToServerMsg;

      /* -------- JOIN must be first -------- */
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

      /* ---------------- Common ---------------- */

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
        return;
      }

      /* ---------------- Lobby: Claims / Players ---------------- */

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
              send(c.ws, { type: "SLOT_INVALIDATED", payload: { room_code, player_id: old, reason: "reset_by_master" } });
            }
          }
        }

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
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

        const desired = typeof msg.payload.name === "string" ? msg.payload.name : "";
        const raw = normalizeName(desired);
        if (raw.length < 1 || raw.length > 24) {
          send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { min: 1, max: 24 }));
          return;
        }

        const unique = pickUniqueName(raw, state.players.map((p) => p.name));
        if (unique.length > 24) {
          send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { max: 24 }));
          return;
        }

        state.players.push({
          player_id: genManualPlayerId(),
          sender_id: null,
          is_sender_bound: false,
          active: true,
          name: unique,
          avatar_url: null,
        });

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
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

        const { player_id } = msg.payload;
        const idx = state.players.findIndex((p) => p.player_id === player_id);
        if (idx === -1) {
          send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
          return;
        }

        const p = state.players[idx];
        if (p.is_sender_bound) {
          send(ws, errorMsg(room_code, "forbidden", "Cannot delete sender-bound player"));
          return;
        }

        if (p.claimed_by) {
          const claimedDevice = p.claimed_by;
          await claimRepo.releaseByPlayer(room_code, player_id);

          const conns = rooms.get(room_code);
          if (conns) {
            for (const c of conns) {
              if (c.device_id === claimedDevice) {
                c.my_player_id = null;
                send(c.ws, { type: "SLOT_INVALIDATED", payload: { room_code, player_id, reason: "disabled_or_deleted" } });
              }
            }
          }
        }

        state.players.splice(idx, 1);
        await repo.setState(room_code, state);
        broadcastState(state, room_code);
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
                send(c.ws, { type: "SLOT_INVALIDATED", payload: { room_code, player_id, reason: "disabled_or_deleted" } });
              }
            }
          }
        }

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "TAKE_PLAYER") {
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        if (!state.setup || state.players.length === 0) {
          send(ws, { type: "TAKE_PLAYER_FAIL", payload: { room_code, player_id: msg.payload.player_id, reason: "setup_not_ready" } });
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
        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "RELEASE_PLAYER") {
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));
          return;
        }

        if (!ctx.my_player_id) {
          send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
          return;
        }

        await claimRepo.releaseByDevice(room_code, device_id);

        const pid = ctx.my_player_id;
        const p = state.players.find((x) => x.player_id === pid);
        if (p && p.claimed_by === device_id) {
          p.claimed_by = undefined;
        }

        ctx.my_player_id = null;

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "RENAME_PLAYER") {
        if (!ctx.my_player_id) {
          send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));
          return;
        }

        const name = normalizeName(msg.payload.new_name);
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

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "UPDATE_AVATAR") {
        if (!ctx.my_player_id) {
          send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));
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

        const parsedImg = parseJpegDataUrl(msg.payload.image);
        if (!parsedImg.ok) {
          send(ws, errorMsg(room_code, "invalid_payload", "Invalid avatar image", { reason: parsedImg.reason }));
          return;
        }

        p.avatar_url = msg.payload.image;

        await repo.setState(room_code, state);
        broadcastState(state, room_code);
        return;
      }

      /* ---------------- Game ---------------- */

      if (msg.type === "START_GAME") {
        if (!ctx.is_master) {
          send(ws, errorMsg(room_code, "not_master", "Master only"));
          return;
        }
        if (state.phase !== "lobby") {
          send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));
          return;
        }
        if (!state.setup) {
          send(ws, errorMsg(room_code, "invalid_state", "Setup missing"));
          return;
        }
        if (state.game) {
          send(ws, errorMsg(room_code, "invalid_state", "Game already started"));
          return;
        }

        const active = state.players.filter((p) => p.active);
        const activeClaimed = active.filter((p) => !!p.claimed_by);

        if (active.length < 2) {
          send(ws, errorMsg(room_code, "validation_error:players", "Need at least 2 active players"));
          return;
        }
        if (activeClaimed.length !== active.length) {
          send(ws, errorMsg(room_code, "validation_error:claims", "All active players must be claimed"));
          return;
        }

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

        broadcast(room_code, { type: "GAME_START", payload: { room_code } });

        const cur = getCurrent(state);
        if (cur) {
          broadcast(room_code, {
            type: "NEW_ITEM",
            payload: {
              room_code,
              round_id: cur.round.round_id,
              item_id: cur.item.item_id,
              reel_url: cur.item.reel_url,
            },
          });
        }

        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "REEL_OPENED") {
        if (!ctx.is_master) return;
        if (state.phase !== "game") return;
        if (!state.game) return;
        if (state.game.status !== "reveal") return;

        const cur = getCurrent(state);
        if (!cur) return;

        state.game.status = "vote";
        state.game.expected_player_ids = expectedPlayersSnapshot(state);
        state.game.votes = {};
        state.game.round_finished = false;

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "START_VOTE",
          payload: {
            room_code,
            round_id: cur.round.round_id,
            item_id: cur.item.item_id,
            senders_selectable: selectableSenders(state),
            k: cur.item.k,
          },
        });

        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "SUBMIT_VOTE") {
        if (state.phase !== "game") return;
        if (!state.game) return;
        if (state.game.status !== "vote") return;
        if (!ctx.my_player_id) return;

        const cur = getCurrent(state);
        if (!cur) return;

        const myPid = ctx.my_player_id;

        if (!state.game.expected_player_ids.includes(myPid)) {
          send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "not_expected_voter" } } as any);
          return;
        }

        const myP = state.players.find((p) => p.player_id === myPid);
        if (!myP || myP.claimed_by !== device_id) {
          ctx.my_player_id = null;
          send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "not_claimed" } } as any);
          return;
        }

        const { selections } = msg.payload;

        if (!Array.isArray(selections) || selections.length !== cur.item.k) {
          send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "too_many" } } as any);
          return;
        }

        const unique = new Set(selections);
        if (unique.size !== selections.length) {
          send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "invalid_selection" } } as any);
          return;
        }

        const selectable = selectableSenders(state);
        for (const s of selections) if (!selectable.includes(s)) {
          send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "invalid_selection" } } as any);
          return;
        }

        state.game.votes[myPid] = selections;

        await repo.setState(room_code, state);

        send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: true } } as any);

        broadcast(room_code, { type: "PLAYER_VOTED", payload: { room_code, player_id: myPid } } as any);

        if (allVotesReceived(state.game)) {
          computeScores(state, cur.item.true_sender_ids);

          state.game.status = "reveal_wait";

          await repo.setState(room_code, state);

          broadcast(room_code, {
            type: "VOTE_RESULTS",
            payload: {
              room_code,
              round_id: cur.round.round_id,
              item_id: cur.item.item_id,
              votes: state.game.votes,
              true_sender_ids: cur.item.true_sender_ids,
              scores: state.scores,
            },
          } as any);

          broadcastState(state, room_code);
        }

        return;
      }

      if (msg.type === "END_ITEM") {
        if (!ctx.is_master) return;
        if (state.phase !== "game") return;
        if (!state.game || !state.setup) return;
        if (state.game.status !== "reveal_wait") return;

        const cur = getCurrent(state);
        if (!cur) return;

        state.game.current_item_index++;

        const round = state.setup.rounds[state.game.current_round_index];

        if (state.game.current_item_index < round.items.length) {
          state.game.status = "reveal";
          state.game.votes = {};
          state.game.expected_player_ids = [];
          state.game.round_finished = false;

          await repo.setState(room_code, state);

          const next = round.items[state.game.current_item_index];
          broadcast(room_code, { type: "NEW_ITEM", payload: { room_code, round_id: round.round_id, item_id: next.item_id, reel_url: next.reel_url } });
          broadcastState(state, room_code);
          return;
        }

        state.game.status = "round_recap";
        state.game.round_finished = true;

        await repo.setState(room_code, state);

        broadcast(room_code, { type: "ROUND_RECAP", payload: { room_code, round_id: round.round_id, scores: state.scores } } as any);
        broadcastState(state, room_code);
        return;
      }

      if (msg.type === "START_NEXT_ROUND") {
        if (!ctx.is_master) return;
        if (state.phase !== "game") return;
        if (!state.game || !state.setup) return;
        if (!state.game.round_finished) return;
        if (state.game.status !== "round_recap") return;

        const prevRound = state.setup.rounds[state.game.current_round_index];

        state.game.current_round_index++;
        state.game.current_item_index = 0;
        state.game.votes = {};
        state.game.expected_player_ids = [];
        state.game.round_finished = false;

        if (state.game.current_round_index >= state.setup.rounds.length) {
          state.phase = "game_over";

          await repo.setState(room_code, state);

          broadcast(room_code, { type: "ROUND_FINISHED", payload: { room_code, round_id: prevRound.round_id } });
          broadcast(room_code, { type: "GAME_OVER", payload: { room_code, scores: state.scores } } as any);
          broadcastState(state, room_code);
          return;
        }

        const round = state.setup.rounds[state.game.current_round_index];

        state.game.status = "reveal";

        await repo.setState(room_code, state);

        broadcast(room_code, { type: "ROUND_FINISHED", payload: { room_code, round_id: prevRound.round_id } });

        const first = round.items[0];
        broadcast(room_code, { type: "NEW_ITEM", payload: { room_code, round_id: round.round_id, item_id: first.item_id, reel_url: first.reel_url } });

        broadcastState(state, room_code);
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
