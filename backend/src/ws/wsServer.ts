import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg, StartVoteMsg, VoteAckMsg, VoteResultsMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import { sha256Hex } from "../utils/hash.js";
import { genManualPlayerId } from "../utils/ids.js";
import type { RoomRepo } from "../state/roomRepo.js";
import { loadRoom } from "../state/getRoom.js";
import type { RoomStateInternal, SetupRound, SetupItem } from "../state/createRoom.js";
import { ClaimRepo } from "../state/claimRepo.js";
import type { ConnCtx } from "./wsTypes.js";

type VoteTimerKey = string;
const voteTimers: Map<VoteTimerKey, NodeJS.Timeout> = new Map();

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
  return { type: "ERROR", payload: { room_code, error, message, details } } as any;
}

function buildStateSync(state: RoomStateInternal, is_master: boolean, my_player_id: string | null): ServerToClientMsg {
  const setup_ready = state.setup !== null;

  const players_visible = state.players.map((p) => ({
    player_id: p.player_id,
    name: p.name,
    avatar_url: p.avatar_url ?? null,
    active: !!p.active,
    status: !p.active ? "disabled" : p.claimed_by ? "taken" : "free",
    claimed_by: is_master ? (p.claimed_by ?? null) : null,
    sender_id: p.sender_id ?? null,
    color: p.color ?? null,
  }));

  const senders_visible = is_master
    ? state.senders.map((s) => ({
        sender_id: s.sender_id,
        name: s.name,
        avatar_url: s.avatar_url ?? null,
        active: !!s.active,
        color: s.color ?? null,
      }))
    : null;

  const payload: any = {
    protocol_version: PROTOCOL_VERSION,
    room_code: state.room_code,
    phase: state.phase,
    setup_ready,
    players_visible,
    my_player_id: my_player_id ?? null,
  };

  if (is_master) {
    payload.senders_visible = senders_visible;
    payload.scores = state.scores ?? {};
    payload.game = state.game ?? null;
    payload.setup = state.setup ?? null;
  } else {
    payload.scores = state.scores ?? {};
    payload.game = state.game ?? null;
  }

  return { type: "STATE_SYNC_RESPONSE", payload } as any;
}

function broadcastStateFromState(state: RoomStateInternal, room_code: string) {
  const conns = rooms.get(room_code);
  if (!conns) return;
  for (const c of conns) {
    send(c.ws, buildStateSync(state, c.is_master, c.my_player_id));
  }
}

function playersInGameIds(state: RoomStateInternal): string[] {
  const g = state.game;
  if (!g) return [];
  return (g.players_in_game ?? []).map((p) => p.player_id);
}

function computeRanking(scores: Record<string, number>) {
  const rows = Object.entries(scores).map(([player_id, score_total]) => ({
    player_id,
    score_total: typeof score_total === "number" ? score_total : 0,
  }));
  rows.sort((a, b) => b.score_total - a.score_total || a.player_id.localeCompare(b.player_id));
  return rows.map((r, i) => ({ player_id: r.player_id, score_total: r.score_total, rank: i + 1 }));
}

function clearVoteTimer(room_code: string) {
  const t = voteTimers.get(room_code);
  if (t) clearTimeout(t);
  voteTimers.delete(room_code);
}

function getRoundOrder(state: RoomStateInternal): string[] {
  if (!state.setup) return [];
  return state.setup.rounds.map((r) => r.round_id);
}

function getSetupRound(state: RoomStateInternal, round_id: string): SetupRound | null {
  if (!state.setup) return null;
  return state.setup.rounds.find((r) => r.round_id === round_id) ?? null;
}

function getSetupItemByIds(state: RoomStateInternal, round_id: string, item_id: string): { round: SetupRound; item: SetupItem } | null {
  const r = getSetupRound(state, round_id);
  if (!r) return null;
  const it = r.items.find((x) => x.item_id === item_id) ?? null;
  if (!it) return null;
  return { round: r, item: it };
}

function selectableSenderIdsForVote(state: RoomStateInternal): Set<string> {
  const g = state.game;
  const sids = new Set<string>();
  if (!g) return sids;

  const ra = g.round_active;
  if (!ra) return sids;

  const used = new Set<string>();
  for (const it of ra.items) {
    if (it.status === "voted" && Array.isArray(it.revealed_sender_ids)) {
      for (const s of it.revealed_sender_ids) used.add(s);
    }
  }

  for (const s of g.senders_in_game ?? []) {
    if (!used.has(s.sender_id)) sids.add(s.sender_id);
  }
  return sids;
}

/* ---------------- WS registration ---------------- */

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
      let msg: ClientToServerMsg | null = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, errorMsg(undefined, "invalid_json", "Invalid JSON"));
        return;
      }
      if (!isClientToServerMsg(msg)) {
        send(ws, errorMsg(undefined, "invalid_msg", "Invalid message"));
        return;
      }

      // JOIN must be first
      if (!ctx.room_code) {
        if (msg.type !== "JOIN_ROOM") {
          send(ws, errorMsg(undefined, "forbidden", "Must JOIN_ROOM first"));
          return;
        }

        const room_code = (msg.payload.room_code ?? "").toUpperCase();
        const device_id = msg.payload.device_id ?? "";

        if (msg.payload.protocol_version !== PROTOCOL_VERSION) {
          send(ws, errorMsg(room_code, "protocol_mismatch", "Protocol mismatch", { expected: PROTOCOL_VERSION }));
          return;
        }

        const room = await loadRoom(repo, room_code);
        if (!room) {
          send(ws, errorMsg(room_code, "room_not_found", "Room not found"));
          return;
        }

        if (Date.now() > room.meta.expires_at) {
          send(ws, errorMsg(room_code, "room_expired", "Room expired"));
          return;
        }

        let is_master = false;
        if (msg.payload.master_key) {
          if (sha256Hex(msg.payload.master_key) !== room.meta.master_hash) {
            send(ws, errorMsg(room_code, "invalid_master_key", "Invalid master key"));
            return;
          }
          is_master = true;
        }

        ctx.room_code = room_code;
        ctx.device_id = device_id;
        ctx.is_master = is_master;

        roomJoin(room_code, ctx);

        send(ws, { type: "JOIN_OK", payload: { room_code, phase: room.state.phase, protocol_version: PROTOCOL_VERSION } } as any);

        // set my_player_id if already claimed by this device (reconnect)
        if (!ctx.is_master) {
          const p = room.state.players.find((pp) => pp.claimed_by === device_id);
          ctx.my_player_id = p?.player_id ?? null;
        }

        send(ws, buildStateSync(room.state, ctx.is_master, ctx.my_player_id));
        return;
      }

      const room_code = ctx.room_code!;
      const device_id = ctx.device_id!;

      const state = await repo.getState<RoomStateInternal>(room_code);
      if (!state) {
        send(ws, errorMsg(room_code, "room_not_found", "Room not found"));
        return;
      }

      /* ---------------- Lobby ---------------- */

      if (msg.type === "REQUEST_SYNC") {
        send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
        return;
      }

      if (msg.type === "TAKE_PLAYER") {
        if (ctx.is_master) return send(ws, errorMsg(room_code, "not_play", "Play only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));
        if (!state.setup) {
          broadcast(room_code, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "setup_not_ready" },
          } as any);
          return;
        }

        const p = state.players.find((pp) => pp.player_id === msg.payload.player_id) ?? null;
        if (!p) {
          broadcast(room_code, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "player_not_found" },
          } as any);
          return;
        }
        if (!p.active) {
          broadcast(room_code, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "inactive" },
          } as any);
          return;
        }

        const exists = true;
        const active = !!p.active;

        const res = await claimRepo.tryClaim(room_code, device_id, p.player_id, exists, active);
        if (!res.ok) {
          broadcast(room_code, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: res.reason === "taken_now" ? "taken_now" : res.reason },
          } as any);
          return;
        }

        p.claimed_by = device_id;
        ctx.my_player_id = p.player_id;

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "TAKE_PLAYER_OK",
          payload: { room_code, my_player_id: p.player_id },
        } as any);

        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "RELEASE_PLAYER") {
        if (ctx.is_master) return send(ws, errorMsg(room_code, "not_play", "Play only"));
        if (!ctx.my_player_id) return;

        const pid = ctx.my_player_id;
        const p = state.players.find((pp) => pp.player_id === pid) ?? null;
        if (p && p.claimed_by === device_id) {
          p.claimed_by = undefined;
        }

        await claimRepo.releaseByDevice(room_code, device_id);
        ctx.my_player_id = null;

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "RENAME_PLAYER") {
        if (ctx.is_master) return send(ws, errorMsg(room_code, "not_play", "Play only"));
        if (!ctx.my_player_id) return send(ws, errorMsg(room_code, "invalid_state", "No player"));

        const pid = ctx.my_player_id;
        const p = state.players.find((pp) => pp.player_id === pid) ?? null;
        if (!p || p.claimed_by !== device_id) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "invalid_state", "No player"));
        }

        const name = String(msg.payload.new_name ?? "").trim().replace(/\s+/g, " ");
        if (!name) return send(ws, errorMsg(room_code, "validation_error:name", "Name required"));
        if (name.length > 24) return send(ws, errorMsg(room_code, "validation_error:name", "Max 24 chars"));

        p.name = name;

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "UPDATE_AVATAR") {
        if (ctx.is_master) return send(ws, errorMsg(room_code, "not_play", "Play only"));
        if (!ctx.my_player_id) return send(ws, errorMsg(room_code, "invalid_state", "No player"));

        const pid = ctx.my_player_id;
        const p = state.players.find((pp) => pp.player_id === pid) ?? null;
        if (!p || p.claimed_by !== device_id) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "invalid_state", "No player"));
        }

        if (typeof msg.payload.image !== "string" || !msg.payload.image.startsWith("data:image/")) {
          return send(ws, errorMsg(room_code, "validation_error:image", "Invalid image"));
        }

        p.avatar_url = msg.payload.image;

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      /* ---------------- Master lobby ---------------- */

      if (msg.type === "TOGGLE_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));

        const p = state.players.find((pp) => pp.player_id === msg.payload.player_id) ?? null;
        if (!p) return send(ws, errorMsg(room_code, "invalid_payload", "Player not found"));

        p.active = !!msg.payload.active;

        if (!p.active && p.claimed_by) {
          broadcast(room_code, {
            type: "SLOT_INVALIDATED",
            payload: { room_code, player_id: p.player_id, reason: "disabled_or_deleted" },
          } as any);
          await claimRepo.releaseByPlayer(room_code, p.player_id);
          p.claimed_by = undefined;
        }

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "RESET_CLAIMS") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));

        await claimRepo.resetClaims(room_code);
        for (const p of state.players) {
          if (p.claimed_by) {
            broadcast(room_code, {
              type: "SLOT_INVALIDATED",
              payload: { room_code, player_id: p.player_id, reason: "reset_by_master" },
            } as any);
          }
          p.claimed_by = undefined;
        }

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "ADD_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));

        const name = String(msg.payload.name ?? "").trim().replace(/\s+/g, " ");
        if (name && name.length > 24) return send(ws, errorMsg(room_code, "validation_error:name", "Max 24 chars"));

        const player_id = genManualPlayerId();
        state.players.push({
          player_id,
          name: name || `Player ${state.players.length + 1}`,
          avatar_url: null,
          active: true,
          claimed_by: undefined,
          sender_id: null,
          color: null,
        });

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "DELETE_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));

        const idx = state.players.findIndex((p) => p.player_id === msg.payload.player_id);
        if (idx === -1) return send(ws, errorMsg(room_code, "invalid_payload", "Player not found"));

        const p = state.players[idx]!;
        if (p.claimed_by) {
          broadcast(room_code, {
            type: "SLOT_INVALIDATED",
            payload: { room_code, player_id: p.player_id, reason: "disabled_or_deleted" },
          } as any);
          await claimRepo.releaseByPlayer(room_code, p.player_id);
        }

        state.players.splice(idx, 1);

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      /* ---------------- Game ---------------- */

      if (msg.type === "START_GAME") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "invalid_state", "Not in lobby"));
        if (!state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Setup missing"));
        if (state.game) return send(ws, errorMsg(room_code, "invalid_state", "Game already started"));

        const activePlayers = state.players.filter((p) => p.active);
        const claimedActive = activePlayers.filter((p) => !!p.claimed_by);
        if (activePlayers.length < 2) return send(ws, errorMsg(room_code, "validation_error:players", "Need at least 2 active players"));
        if (claimedActive.length !== activePlayers.length) {
          return send(ws, errorMsg(room_code, "validation_error:claims", "All active players must be claimed"));
        }

        const order = getRoundOrder(state);
        const firstRid = order[0] ?? state.setup.rounds[0]?.round_id ?? null;
        if (!firstRid) return send(ws, errorMsg(room_code, "invalid_state", "No rounds"));

        const firstRound = getSetupRound(state, firstRid);
        if (!firstRound || firstRound.items.length === 0) return send(ws, errorMsg(room_code, "invalid_state", "First round has no items"));

        // Assign stable colors and persist in PlayerAll/SenderAll.
        const palette = [
          "#FF6B6B",
          "#FFD93D",
          "#6BCB77",
          "#4D96FF",
          "#845EC2",
          "#FF9671",
          "#00C9A7",
          "#F9F871",
          "#C34A36",
          "#0081CF",
          "#B0A8B9",
          "#00C2A8",
        ];

        const sendersInGame = state.senders.filter((s) => s.active);
        const senderColors = new Map<string, string>();
        for (let i = 0; i < sendersInGame.length; i++) senderColors.set(sendersInGame[i].sender_id, palette[i % palette.length]);

        for (const s of state.senders) {
          if (s.active) s.color = senderColors.get(s.sender_id);
        }

        let nextColorIdx = sendersInGame.length;
        for (const p of state.players) {
          if (!p.active) continue;
          const bound = p.sender_id ? senderColors.get(p.sender_id) : undefined;
          p.color = bound ?? palette[nextColorIdx++ % palette.length];
          if (typeof state.scores[p.player_id] !== "number") state.scores[p.player_id] = 0;
        }

        // Propagate player avatars to their linked senders at game start.
        // If a player is bound to a sender (same person) and has an avatar, use it for the sender too.
        const playerAvatarBySenderId = new Map<string, string>();
        for (const p of state.players) {
          if (!p.active) continue;
          if (!p.sender_id) continue;
          if (typeof p.avatar_url !== "string" || !p.avatar_url) continue;
          playerAvatarBySenderId.set(p.sender_id, p.avatar_url);
        }
        for (const s of state.senders) {
          if (!s.active) continue;
          const a = playerAvatarBySenderId.get(s.sender_id);
          if (a) s.avatar_url = a;
        }

        state.phase = "game";

        const items = firstRound.items.map((it) => ({
          round_id: firstRound.round_id,
          item_id: it.item_id,
          reel: { url: (it.reel as any).url },
          k: it.k,
          status: "pending" as const,
        }));

        state.game = {
          view: "round_active",
          players_in_game: claimedActive.map((p) => ({
            player_id: p.player_id,
            name: p.name,
            avatar_url: p.avatar_url ?? null,
            color: p.color ?? "#888888",
            sender_id: p.sender_id ?? null,
          })),
          senders_in_game: sendersInGame.map((s) => ({
            sender_id: s.sender_id,
            name: s.name,
            avatar_url: s.avatar_url ?? null,
            color: s.color ?? "#888888",
          })),
          round_active: {
            view: "round_active",
            phase: "waiting",
            current_round_id: firstRound.round_id,
            active_item_id: null,
            items,
          },
        };

        state.votes_by_player = {};
        clearVoteTimer(room_code);

        await repo.setState(room_code, state);
        broadcast(room_code, { type: "GAME_START", payload: { room_code } } as any);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "OPEN_ITEM") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !state.game || !state.setup)
          return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));
        if (state.game.view !== "round_active" || !state.game.round_active) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not in round_active"));
        }

        const ra = state.game.round_active;

        if (msg.payload.round_id !== ra.current_round_id) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not current round"));
        }

        const item = ra.items.find((it) => it.item_id === msg.payload.item_id) ?? null;
        if (!item) return send(ws, errorMsg(room_code, "invalid_payload", "Item not found"));

        // Robust no-op:
        // - voted => never starts anything server-side
        // - voting => double-click safe no-op
        if (item.status === "voted") return;
        if (item.status === "voting") return;

        // Only pending items can start a vote, and only while waiting.
        if (ra.phase !== "waiting") return send(ws, errorMsg(room_code, "conflict", "Vote already in progress"));

        item.status = "voting";
        ra.phase = "voting";
        ra.active_item_id = item.item_id;
        ra.voting = {
          round_id: ra.current_round_id,
          item_id: item.item_id,
          expected_player_ids: playersInGameIds(state),
          votes_received_player_ids: [],
        };

        state.votes_by_player = {};
        clearVoteTimer(room_code);

        await repo.setState(room_code, state);

        const payload: StartVoteMsg["payload"] = {
          room_code,
          round_id: ra.current_round_id,
          item_id: item.item_id,
          k: item.k,
        };

        broadcast(room_code, { type: "START_VOTE", payload } as any);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "SUBMIT_VOTE") {
        if (state.phase !== "game" || !state.game || !state.setup) return;

        if (state.game.view !== "round_active" || !state.game.round_active) {
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "not_in_vote",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        const ra = state.game.round_active;
        if (ra.phase !== "voting" || !ra.voting || !ra.active_item_id) {
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "not_in_vote",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        if (!ctx.my_player_id) {
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "not_claimed",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        const myPid = ctx.my_player_id;
        const myP = state.players.find((p) => p.player_id === myPid);
        if (!myP || myP.claimed_by !== device_id) {
          ctx.my_player_id = null;
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "not_claimed",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        if (msg.payload.round_id !== ra.current_round_id || msg.payload.item_id !== ra.active_item_id) {
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "late",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        const item = ra.items.find((it) => it.item_id === ra.active_item_id) ?? null;
        if (!item) {
          const nack: VoteAckMsg["payload"] = {
            room_code,
            round_id: msg.payload.round_id,
            item_id: msg.payload.item_id,
            accepted: false,
            reason: "not_in_vote",
          };
          send(ws, { type: "VOTE_ACK", payload: nack } as any);
          return;
        }

        let selections = Array.isArray(msg.payload.selections) ? msg.payload.selections : [];

        // Dedup while preserving order
        const seen = new Set<string>();
        selections = selections.filter((s) => {
          if (typeof s !== "string") return false;
          if (seen.has(s)) return false;
          seen.add(s);
          return true;
        });

        // Validate selectable
        const selectableIds = selectableSenderIdsForVote(state);
        for (const s of selections) {
          if (!selectableIds.has(s)) {
            const nack: VoteAckMsg["payload"] = {
              room_code,
              round_id: msg.payload.round_id,
              item_id: msg.payload.item_id,
              accepted: false,
              reason: "invalid_selection",
            };
            send(ws, { type: "VOTE_ACK", payload: nack } as any);
            return;
          }
        }

        // Clamp to K (player can vote 0..K)
        if (selections.length > item.k) selections = selections.slice(0, item.k);

        if (!state.votes_by_player) state.votes_by_player = {};
        state.votes_by_player[myPid] = selections;

        const got = new Set(ra.voting.votes_received_player_ids ?? []);
        got.add(myPid);
        ra.voting.votes_received_player_ids = Array.from(got);

        await repo.setState(room_code, state);

        const ack: VoteAckMsg["payload"] = {
          room_code,
          round_id: ra.current_round_id,
          item_id: item.item_id,
          accepted: true,
        };
        send(ws, { type: "VOTE_ACK", payload: ack } as any);

        broadcast(room_code, {
          type: "PLAYER_VOTED",
          payload: { room_code, round_id: ra.current_round_id, item_id: item.item_id, player_id: myPid },
        } as any);

        // Auto-close when everyone voted
        const expected = ra.voting.expected_player_ids;
        const allVoted = expected.every((pid) => ra.voting!.votes_received_player_ids.includes(pid));
        if (!allVoted) {
          broadcastStateFromState(state, room_code);
          return;
        }

        const setupItem = getSetupItemByIds(state, ra.current_round_id, item.item_id);
        if (!setupItem) return;

        const trueSenders = setupItem.item.true_sender_ids;
        const resultsPlayers = expected.map((pid) => {
          const sel = Array.isArray(state.votes_by_player?.[pid]) ? state.votes_by_player![pid] : [];
          const correct = sel.filter((s) => trueSenders.includes(s));
          const incorrect = sel.filter((s) => !trueSenders.includes(s));
          const missing = trueSenders.filter((s) => !sel.includes(s));
          const points_gained = correct.length;
          const score_total = (state.scores[pid] ?? 0) + points_gained;
          return { player_id: pid, selections: sel, correct, incorrect, missing, points_gained, score_total };
        });

        for (const r of resultsPlayers) state.scores[r.player_id] = r.score_total;

        item.status = "voted";
        item.revealed_sender_ids = trueSenders;

        ra.phase = "waiting";
        ra.active_item_id = null;
        ra.voting = undefined;

        state.game.last_vote_results = {
          round_id: ra.current_round_id,
          item_id: item.item_id,
          true_senders: trueSenders,
          players: resultsPlayers,
        };

        state.votes_by_player = {};
        clearVoteTimer(room_code);

        const roundDone = ra.items.every((it) => it.status === "voted");
        if (roundDone) {
          const order = getRoundOrder(state);
          const idx = order.indexOf(ra.current_round_id);
          const hasNext = idx !== -1 && !!order[idx + 1];

          const ranking = computeRanking(state.scores);
          state.game.view = "round_score_modal";
          state.game.round_active = undefined;
          state.game.round_score_modal = {
            view: "round_score_modal",
            current_round_id: ra.current_round_id,
            game_over: !hasNext,
            ranking,
          };
        }

        await repo.setState(room_code, state);

        const res: VoteResultsMsg["payload"] = { room_code, ...state.game.last_vote_results };
        broadcast(room_code, { type: "VOTE_RESULTS", payload: res } as any);
        broadcast(room_code, {
          type: "ITEM_VOTED",
          payload: { room_code, round_id: ra.current_round_id, item_id: item.item_id, true_senders: trueSenders },
        } as any);

        if (state.game.view === "round_score_modal" && state.game.round_score_modal) {
          broadcast(room_code, {
            type: "ROUND_SCORE_MODAL",
            payload: {
              room_code,
              round_id: state.game.round_score_modal.current_round_id,
              game_over: state.game.round_score_modal.game_over,
              ranking: state.game.round_score_modal.ranking,
              scores: state.scores,
            },
          } as any);
        }

        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "FORCE_CLOSE_VOTE") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !state.game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));
        if (state.game.view !== "round_active" || !state.game.round_active) return send(ws, errorMsg(room_code, "invalid_state", "Not in round_active"));
        const ra = state.game.round_active;
        if (ra.phase !== "voting" || !ra.voting || !ra.active_item_id) return send(ws, errorMsg(room_code, "invalid_state", "Not in voting"));
        if (msg.payload.round_id !== ra.current_round_id || msg.payload.item_id !== ra.active_item_id) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not current vote"));
        }

        const ends = Date.now() + 10_000;
        ra.voting.force_close_ends_at_ms = ends;

        clearVoteTimer(room_code);
        voteTimers.set(
          room_code,
          setTimeout(() => {
            void (async () => {
              const latest = await repo.getState<RoomStateInternal>(room_code);
              if (!latest || latest.phase !== "game" || !latest.game || latest.game.view !== "round_active" || !latest.game.round_active) return;
              const lra = latest.game.round_active;
              if (lra.phase !== "voting" || !lra.voting || !lra.active_item_id) return;
              if (Date.now() < (lra.voting.force_close_ends_at_ms ?? 0)) return;

              const activeItem = lra.items.find((it) => it.item_id === lra.active_item_id) ?? null;
              if (!activeItem) return;
              const setupItem = getSetupItemByIds(latest, lra.current_round_id, activeItem.item_id);
              if (!setupItem) return;

              const trueSenders = setupItem.item.true_sender_ids;
              const expected = lra.voting.expected_player_ids;

              const resultsPlayers = expected.map((pid) => {
                const sel = Array.isArray(latest.votes_by_player?.[pid]) ? latest.votes_by_player![pid] : [];
                const correct = sel.filter((s) => trueSenders.includes(s));
                const incorrect = sel.filter((s) => !trueSenders.includes(s));
                const missing = trueSenders.filter((s) => !sel.includes(s));
                const points_gained = correct.length;
                const score_total = (latest.scores[pid] ?? 0) + points_gained;
                return { player_id: pid, selections: sel, correct, incorrect, missing, points_gained, score_total };
              });

              for (const r of resultsPlayers) latest.scores[r.player_id] = r.score_total;

              activeItem.status = "voted";
              activeItem.revealed_sender_ids = trueSenders;

              lra.phase = "waiting";
              lra.active_item_id = null;
              lra.voting = undefined;

              latest.votes_by_player = {};
              latest.game.last_vote_results = {
                round_id: lra.current_round_id,
                item_id: activeItem.item_id,
                true_senders: trueSenders,
                players: resultsPlayers,
              };

              const roundDone = lra.items.every((it) => it.status === "voted");
              if (roundDone) {
                const order = getRoundOrder(latest);
                const idx = order.indexOf(lra.current_round_id);
                const hasNext = idx !== -1 && !!order[idx + 1];
                const ranking = computeRanking(latest.scores);

                latest.game.view = "round_score_modal";
                latest.game.round_active = undefined;
                latest.game.round_score_modal = {
                  view: "round_score_modal",
                  current_round_id: lra.current_round_id,
                  game_over: !hasNext,
                  ranking,
                };
              }

              await repo.setState(room_code, latest);

              const res: VoteResultsMsg["payload"] = { room_code, ...latest.game.last_vote_results! };
              broadcast(room_code, { type: "VOTE_RESULTS", payload: res } as any);
              broadcast(room_code, {
                type: "ITEM_VOTED",
                payload: { room_code, round_id: lra.current_round_id, item_id: activeItem.item_id, true_senders: trueSenders },
              } as any);

              if (latest.game.view === "round_score_modal" && latest.game.round_score_modal) {
                broadcast(room_code, {
                  type: "ROUND_SCORE_MODAL",
                  payload: {
                    room_code,
                    round_id: latest.game.round_score_modal.current_round_id,
                    game_over: latest.game.round_score_modal.game_over,
                    ranking: latest.game.round_score_modal.ranking,
                    scores: latest.scores,
                  },
                } as any);
              }

              broadcastStateFromState(latest, room_code);
            })();
          }, 10_050)
        );

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "VOTE_FORCE_CLOSE_STARTED",
          payload: { room_code, round_id: ra.current_round_id, item_id: ra.active_item_id, ends_at_ms: ends },
        } as any);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "START_NEXT_ROUND") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !state.game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));
        if (state.game.view !== "round_score_modal" || !state.game.round_score_modal) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not in round_score_modal"));
        }

        const prevRid = state.game.round_score_modal.current_round_id;
        const order = getRoundOrder(state);
        const idx = order.indexOf(prevRid);
        if (idx === -1) return send(ws, errorMsg(room_code, "invalid_state", "Round not found"));
        const nextRid = order[idx + 1] ?? null;
        if (!nextRid) return send(ws, errorMsg(room_code, "invalid_state", "No next round"));

        const nextRound = getSetupRound(state, nextRid);
        if (!nextRound || nextRound.items.length === 0) return send(ws, errorMsg(room_code, "invalid_state", "Next round has no items"));

        const items = nextRound.items.map((it) => ({
          round_id: nextRound.round_id,
          item_id: it.item_id,
          reel: { url: (it.reel as any).url },
          k: it.k,
          status: "pending" as const,
        }));

        state.game.view = "round_active";
        state.game.round_score_modal = undefined;
        state.game.round_active = {
          view: "round_active",
          phase: "waiting",
          current_round_id: nextRound.round_id,
          active_item_id: null,
          items,
        };

        state.votes_by_player = {};
        clearVoteTimer(room_code);

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "ROOM_CLOSED") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        broadcast(room_code, { type: "ROOM_CLOSED_BROADCAST", payload: { room_code, reason: "closed_by_master" } } as any);
        return;
      }
    });

    ws.on("close", () => {
      if (ctx.room_code) roomLeave(ctx.room_code, ctx);
    });
  });
}
