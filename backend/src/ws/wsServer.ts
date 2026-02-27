import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type {
  ClientToServerMsg,
  ServerToClientMsg,
  StartVoteMsg,
  VoteAckMsg,
  VoteResultsMsg,
} from "@brp/contracts/ws";
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

  const players_visible = state.players
    .filter((p) => p.active)
    .map((p) => ({
      player_id: p.player_id,
      sender_id: p.sender_id,
      is_sender_bound: p.is_sender_bound,
      active: p.active,
      status: p.claimed_by ? ("taken" as const) : ("free" as const),
      name: p.name,
      avatar_url: p.avatar_url ?? null,
    }));

  const senders_visible = state.senders
    .filter((s) => s.active)
    .map((s) => ({
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
      setup_ready,
      players_visible,
      senders_visible,
      players_all: is_master ? state.players : undefined,
      senders_all: is_master ? state.senders : undefined,
      my_player_id,
      game: state.game,
      scores: state.scores,
    },
  } as any;
}

function parseJpegDataUrl(input: string): { ok: true; bytes: number } | { ok: false; reason: string } {
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
    return { ok: true, bytes: buf.length };
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }
}

/**
 * Broadcast from the in-memory state (post-mutation), not by re-loading from Redis.
 * Guarantees Master gets updates immediately (avatar, claims, etc.).
 */
function broadcastStateFromState(state: RoomStateInternal, room_code: string) {
  const conns = rooms.get(room_code);
  if (!conns) return;
  for (const c of conns) send(c.ws, buildStateSync(state, c.is_master, c.my_player_id));
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

/* ---------------- Game helpers ---------------- */

function getRoundOrder(state: RoomStateInternal): string[] {
  const setup = state.setup;
  if (!setup) return [];
  if (Array.isArray(setup.round_order) && setup.round_order.length > 0) return setup.round_order;
  return setup.rounds.map((r) => r.round_id);
}

function getSetupRound(state: RoomStateInternal, round_id: string): SetupRound | null {
  const setup = state.setup;
  if (!setup) return null;
  return setup.rounds.find((r) => r.round_id === round_id) ?? null;
}

function getSetupItemByIds(
  state: RoomStateInternal,
  round_id: string,
  item_id: string
): { round: SetupRound; item: SetupItem } | null {
  const round = getSetupRound(state, round_id);
  if (!round) return null;
  const item = round.items.find((it) => it.item_id === item_id) ?? null;
  if (!item) return null;
  return { round, item };
}

function selectableSenderIdsForVote(state: RoomStateInternal): Set<string> {
  const g = state.game;
  const ids = new Set<string>();
  if (!g) return ids;
  for (const s of g.senders_in_game ?? []) ids.add(s.sender_id);
  return ids;
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

function computeRankingForPlayers(scores: Record<string, number>, playerIds: string[]) {
  const set = new Set(playerIds);
  const rows = Object.entries(scores)
    .filter(([pid]) => set.has(pid))
    .map(([player_id, score_total]) => ({
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

        send(ws, {
          type: "JOIN_OK",
          payload: { room_code, phase: state.phase, protocol_version: PROTOCOL_VERSION },
        } as any);

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

      /* ---------------- Lobby ---------------- */

      if (msg.type === "RESET_CLAIMS") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

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
              } as any);
            }
          }
        }

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "ADD_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        const desired = typeof msg.payload.name === "string" ? msg.payload.name : "";
        const rawName = normalizeName(desired);
        if (rawName.length < 1 || rawName.length > 24) {
          return send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { min: 1, max: 24 }));
        }

        const unique = pickUniqueName(rawName, state.players.map((p) => p.name));
        if (unique.length > 24) return send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { max: 24 }));

        state.players.push({
          player_id: genManualPlayerId(),
          sender_id: null,
          is_sender_bound: false,
          active: true,
          name: unique,
          avatar_url: null,
        });

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "DELETE_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        const player_id = msg.payload.player_id;
        const idx = state.players.findIndex((p) => p.player_id === player_id);
        if (idx === -1) return send(ws, errorMsg(room_code, "player_not_found", "Player not found"));

        const p = state.players[idx];
        if (p.is_sender_bound) return send(ws, errorMsg(room_code, "forbidden", "Cannot delete sender-bound player"));

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
                } as any);
              }
            }
          }
        }

        state.players.splice(idx, 1);

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "TOGGLE_PLAYER") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        const { player_id, active } = msg.payload;
        const p = state.players.find((x) => x.player_id === player_id);
        if (!p) return send(ws, errorMsg(room_code, "player_not_found", "Player not found"));

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
                } as any);
              }
            }
          }
        }

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "RELEASE_PLAYER") {
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        if (!ctx.my_player_id) {
          send(ws, buildStateSync(state, ctx.is_master, ctx.my_player_id));
          return;
        }

        await claimRepo.releaseByDevice(room_code, device_id);

        const pid = ctx.my_player_id;
        const p = state.players.find((x) => x.player_id === pid);
        if (p && p.claimed_by === device_id) p.claimed_by = undefined;

        ctx.my_player_id = null;

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "TAKE_PLAYER") {
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        if (!state.setup || state.players.length === 0) {
          send(ws, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "setup_not_ready" },
          } as any);
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
          } as any);
          return;
        }

        p!.claimed_by = device_id;
        ctx.my_player_id = player_id;

        await repo.setState(room_code, state);

        send(ws, { type: "TAKE_PLAYER_OK", payload: { room_code, my_player_id: player_id } } as any);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "RENAME_PLAYER") {
        if (!ctx.my_player_id) return send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));

        const name = normalizeName(msg.payload.new_name);
        if (name.length < 1 || name.length > 24) {
          return send(ws, errorMsg(room_code, "invalid_payload", "Invalid name length", { min: 1, max: 24 }));
        }

        const p = state.players.find((x) => x.player_id === ctx.my_player_id);
        if (!p) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
        }
        if (p.claimed_by !== device_id) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "not_claimed", "Claim mismatch"));
        }

        p.name = name;

        await repo.setState(room_code, state);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "UPDATE_AVATAR") {
        if (!ctx.my_player_id) return send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));

        const p = state.players.find((x) => x.player_id === ctx.my_player_id);
        if (!p) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "player_not_found", "Player not found"));
        }
        if (p.claimed_by !== device_id) {
          ctx.my_player_id = null;
          return send(ws, errorMsg(room_code, "not_claimed", "Claim mismatch"));
        }

        const parsed = parseJpegDataUrl(msg.payload.image);
        if (!parsed.ok) return send(ws, errorMsg(room_code, "invalid_payload", "Invalid avatar image", { reason: parsed.reason }));

        p.avatar_url = msg.payload.image;

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

        // Assign stable colors (simple palette) and persist into PlayerAll/SenderAll for UI placeholders.
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

        // Persist sender colors
        for (const s of state.senders) {
          if (s.active) s.color = senderColors.get(s.sender_id);
        }

        // Persist player colors (if player is bound to sender, reuse sender color; else assign next colors)
        let nextColorIdx = sendersInGame.length;
        for (const p of state.players) {
          if (!p.active) continue;
          const bound = p.sender_id ? senderColors.get(p.sender_id) : undefined;
          p.color = bound ?? palette[nextColorIdx++ % palette.length];
          if (typeof state.scores[p.player_id] !== "number") state.scores[p.player_id] = 0;
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
        if (state.phase !== "game" || !state.game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));
        if (state.game.view !== "round_active" || !state.game.round_active) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not in round_active"));
        }
        const ra = state.game.round_active;
        if (ra.phase !== "waiting") return send(ws, errorMsg(room_code, "conflict", "Vote already in progress"));
        if (msg.payload.round_id !== ra.current_round_id) return send(ws, errorMsg(room_code, "invalid_state", "Not current round"));

        const item = ra.items.find((it) => it.item_id === msg.payload.item_id) ?? null;
        if (!item) return send(ws, errorMsg(room_code, "invalid_payload", "Item not found"));

        if (item.status === "voted") {
          // No-op server; master may still open URL locally.
          return;
        }
        if (item.status === "voting") return send(ws, errorMsg(room_code, "conflict", "Item already voting"));

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

      const closeVote = async (reason: "all_voted" | "timeout") => {
        if (state.phase !== "game" || !state.game || !state.setup) return;
        if (state.game.view !== "round_active" || !state.game.round_active) return;
        const ra = state.game.round_active;
        if (ra.phase !== "voting" || !ra.active_item_id || !ra.voting) return;

        const activeItem = ra.items.find((it) => it.item_id === ra.active_item_id) ?? null;
        if (!activeItem) return;

        const setupItem = getSetupItemByIds(state, ra.current_round_id, activeItem.item_id);
        if (!setupItem) return;
        const trueSenders = setupItem.item.true_sender_ids;

        const expected = ra.voting.expected_player_ids;

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

        // Commit item
        activeItem.status = "voted";
        activeItem.revealed_sender_ids = trueSenders;

        // Exit voting
        ra.phase = "waiting";
        ra.active_item_id = null;
        ra.voting = undefined;

        state.game.last_vote_results = {
          round_id: ra.current_round_id,
          item_id: activeItem.item_id,
          true_senders: trueSenders,
          players: resultsPlayers,
        };

        state.votes_by_player = {};
        clearVoteTimer(room_code);

        // If round is complete => score modal
        const roundDone = ra.items.every((it) => it.status === "voted");
        if (roundDone) {
          const order = getRoundOrder(state);
          const idx = order.indexOf(ra.current_round_id);
          const hasNext = idx !== -1 && !!order[idx + 1];

          const ranking = computeRankingForPlayers(state.scores, playersInGameIds(state));
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

        const res: VoteResultsMsg["payload"] = {
          room_code,
          ...state.game.last_vote_results!,
        };
        broadcast(room_code, { type: "VOTE_RESULTS", payload: res } as any);
        broadcast(room_code, {
          type: "ITEM_VOTED",
          payload: { room_code, round_id: ra.current_round_id, item_id: activeItem.item_id, true_senders: trueSenders },
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
      };

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

        // Clamp to K
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

        const expected = ra.voting.expected_player_ids;
        const allVoted = expected.every((pid) => ra.voting!.votes_received_player_ids.includes(pid));
        if (allVoted) {
          await closeVote("all_voted");
          return;
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
            // fire-and-forget; next incoming message will load latest state anyway.
            // We load state fresh to avoid closing outdated votes.
            void (async () => {
              const latest = await repo.getState<RoomStateInternal>(room_code);
              if (!latest || latest.phase !== "game" || !latest.game || latest.game.view !== "round_active" || !latest.game.round_active) return;
              const lra = latest.game.round_active;
              if (lra.phase !== "voting" || !lra.voting || !lra.active_item_id) return;
              if (Date.now() < (lra.voting.force_close_ends_at_ms ?? 0)) return;

              // mutate + close using the same logic as above, but we can't access closeVote closure here.
              // Minimal: mark a synthetic message by broadcasting REQUEST_SYNC; the next master action will close.
              // Better: inline a simplified close.
              // We'll inline by reusing the same algorithm quickly.
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
                const ranking = computeRankingForPlayers(latest.scores, playersInGameIds(latest));
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
        if (!nextRid) {
          state.phase = "game_over";
          state.game.round_score_modal.game_over = true;
          await repo.setState(room_code, state);
          broadcastStateFromState(state, room_code);
          return;
        }

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
        await repo.delRoomAll(room_code);
        broadcast(room_code, { type: "ROOM_CLOSED_BROADCAST", payload: { room_code, reason: "closed_by_master" } } as any);
        clearVoteTimer(room_code);
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
