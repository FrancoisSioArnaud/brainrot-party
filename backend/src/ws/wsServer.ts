import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type WebSocket from "ws";

import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { isClientToServerMsg } from "@brp/contracts/ws";

import { sha256Hex } from "../utils/hash.js";
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
      game: (state as any).game ?? null,
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
 * CRITICAL: broadcast from the in-memory state (post-mutation), not by re-loading from Redis.
 */
function broadcastStateFromState(state: RoomStateInternal, room_code: string) {
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

/* ---------------- Game helpers ---------------- */

function getSetupRound(state: RoomStateInternal, round_id: string) {
  const setup = state.setup;
  if (!setup) return null;
  return setup.rounds.find((r) => r.round_id === round_id) ?? null;
}

function getRoundOrder(state: RoomStateInternal): string[] {
  const setup = state.setup;
  if (!setup) return [];
  if (Array.isArray(setup.round_order) && setup.round_order.length > 0) return setup.round_order;
  return setup.rounds.map((r) => r.round_id);
}

function getCurrentSetupItem(state: RoomStateInternal) {
  const g: any = (state as any).game;
  if (!state.setup || !g) return null;

  const rid = g.current_round_id as string | null;
  const idx = typeof g.current_item_index === "number" ? (g.current_item_index as number) : 0;
  if (!rid) return null;

  const round = getSetupRound(state, rid);
  if (!round) return null;

  const item = round.items[idx] ?? null;
  if (!item) return null;

  return { round, item, item_index: idx };
}

function activeSelectableSenders(state: RoomStateInternal) {
  return state.senders.filter((s) => s.active).map((s) => ({ sender_id: s.sender_id, name: s.name }));
}

function activeClaimedPlayers(state: RoomStateInternal) {
  return state.players.filter((p) => p.active && !!p.claimed_by);
}

function computeRanking(scores: Record<string, number>) {
  const rows = Object.entries(scores).map(([player_id, score_total]) => ({
    player_id,
    score_total: typeof score_total === "number" ? score_total : 0,
  }));
  rows.sort((a, b) => b.score_total - a.score_total || a.player_id.localeCompare(b.player_id));

  return rows.map((r, i) => ({ player_id: r.player_id, score_total: r.score_total, rank: i + 1 }));
}

function newItemPayload(state: RoomStateInternal) {
  const cur = getCurrentSetupItem(state);
  if (!cur) return null;

  const senders_selectable = activeSelectableSenders(state);
  const slots_total = activeClaimedPlayers(state).length;

  return {
    room_code: state.room_code,
    round_id: cur.round.round_id,
    item_index: cur.item_index,
    item_id: cur.item.item_id,
    reel: cur.item.reel,
    reel_url: cur.item.reel.url, // NEW
    k: cur.item.k,
    senders_selectable,
    slots_total,
  };
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
          send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { min: 1, max: 24 }));
          return;
        }

        const unique = pickUniqueName(rawName, state.players.map((p) => p.name));
        if (unique.length > 24) {
          send(ws, errorMsg(room_code, "validation_error:name", "Invalid name", { max: 24 }));
          return;
        }

        // NOTE: manual player id generator exists elsewhere in your repo; keep current behavior.
        // This file previously relied on genManualPlayerId(), which may exist in your current version.
        // If missing, keep server-side id generation where it already is in your branch.
        const anyState = state as any;
        const genManualPlayerId = anyState.__genManualPlayerId as (() => string) | undefined;

        state.players.push({
          player_id: genManualPlayerId ? genManualPlayerId() : `manual_${Date.now()}_${Math.random().toString(16).slice(2)}`,
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

      if (msg.type === "TAKE_PLAYER") {
        if (state.phase !== "lobby") return send(ws, errorMsg(room_code, "not_in_phase", "Not in lobby"));

        if (!state.setup || state.players.length === 0) {
          send(ws, {
            type: "TAKE_PLAYER_FAIL",
            payload: { room_code, player_id: msg.payload.player_id, reason: "setup_not_ready" },
          } as any);
          return;
        }

        const player_id = msg.payload.player_id;
        const p = state.players.find((x) => x.player_id === player_id);

        const claim = await claimRepo.claim(room_code, device_id, player_id, !!p, !!p?.active);
        if (!claim.ok) {
          send(ws, {
            type: "TAKE_PLAYER_FAIL",
            payload: {
              room_code,
              player_id,
              reason: claim.reason,
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

      if (msg.type === "RENAME_PLAYER") {
        if (!ctx.my_player_id) return send(ws, errorMsg(room_code, "not_claimed", "No claimed player"));

        const name = normalizeName(msg.payload.new_name);
        if (name.length < 1 || name.length > 24) return send(ws, errorMsg(room_code, "invalid_payload", "Invalid name length"));

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

        const parsedImg = parseJpegDataUrl(msg.payload.image);
        if (!parsedImg.ok) return send(ws, errorMsg(room_code, "invalid_payload", "Invalid avatar image", { reason: parsedImg.reason }));

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
        if ((state as any).game) return send(ws, errorMsg(room_code, "invalid_state", "Game already started"));

        const active = state.players.filter((p) => p.active);
        const claimedActive = active.filter((p) => !!p.claimed_by);

        if (active.length < 2) return send(ws, errorMsg(room_code, "validation_error:players", "Need at least 2 active players"));
        if (claimedActive.length !== active.length) return send(ws, errorMsg(room_code, "validation_error:claims", "All active players must be claimed"));

        const order = getRoundOrder(state);
        const firstRid = order[0] ?? state.setup.rounds[0]?.round_id ?? null;
        if (!firstRid) return send(ws, errorMsg(room_code, "invalid_state", "No rounds"));

        const firstRound = getSetupRound(state, firstRid);
        if (!firstRound || firstRound.items.length === 0) return send(ws, errorMsg(room_code, "invalid_state", "No items"));

        // init scores for active claimed players (keep existing if present)
        for (const p of claimedActive) {
          if (typeof state.scores[p.player_id] !== "number") state.scores[p.player_id] = 0;
        }

        state.phase = "game";
        (state as any).game = {
          current_round_id: firstRid,
          current_item_index: 0,
          status: "idle",
          item: null,
          votes_received_player_ids: [],
          current_vote_results: undefined,
        };

        const payload = newItemPayload(state);
        if (!payload) return send(ws, errorMsg(room_code, "invalid_state", "No current item"));

        (state as any).game.item = {
          round_id: payload.round_id,
          item_id: payload.item_id,
          reel: payload.reel,
          k: payload.k,
          senders_selectable: payload.senders_selectable,
        };

        (state as any).__votesByPlayer = {};
        (state as any).__roundScores = {};

        await repo.setState(room_code, state);

        broadcast(room_code, { type: "GAME_START", payload: { room_code } } as any);
        broadcast(room_code, { type: "NEW_ITEM", payload } as any);
        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "REEL_OPENED") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !(state as any).game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));

        const cur = getCurrentSetupItem(state);
        if (!cur) return send(ws, errorMsg(room_code, "invalid_state", "No current item"));

        // only allow opening vote for the current item
        if (msg.payload.round_id !== cur.round.round_id || msg.payload.item_id !== cur.item.item_id) {
          return send(ws, errorMsg(room_code, "invalid_state", "Not current item"));
        }

        (state as any).game.status = "vote";
        (state as any).game.votes_received_player_ids = [];
        (state as any).game.current_vote_results = undefined;
        (state as any).__votesByPlayer = {};

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "START_VOTE",
          payload: {
            room_code,
            round_id: cur.round.round_id,
            item_id: cur.item.item_id,
            k: cur.item.k,
            senders_selectable: activeSelectableSenders(state),
          },
        } as any);

        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "SUBMIT_VOTE") {
        if (state.phase !== "game" || !(state as any).game || !state.setup) return;

        const g: any = (state as any).game;
        if (g.status !== "vote") {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: msg.payload.round_id, item_id: msg.payload.item_id, accepted: false, reason: "not_in_vote" },
          } as any);
          return;
        }

        if (!ctx.my_player_id) {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: msg.payload.round_id, item_id: msg.payload.item_id, accepted: false, reason: "not_claimed" },
          } as any);
          return;
        }

        const cur = getCurrentSetupItem(state);
        if (!cur) {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: msg.payload.round_id, item_id: msg.payload.item_id, accepted: false, reason: "late" },
          } as any);
          return;
        }

        if (msg.payload.round_id !== cur.round.round_id || msg.payload.item_id !== cur.item.item_id) {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: msg.payload.round_id, item_id: msg.payload.item_id, accepted: false, reason: "late" },
          } as any);
          return;
        }

        const myPid = ctx.my_player_id;
        const myP = state.players.find((p) => p.player_id === myPid);
        if (!myP || myP.claimed_by !== device_id) {
          ctx.my_player_id = null;
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "not_claimed" },
          } as any);
          return;
        }

        const selections = msg.payload.selections ?? [];
        if (!Array.isArray(selections) || selections.length !== cur.item.k) {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "too_many" },
          } as any);
          return;
        }

        const uniq = new Set(selections);
        if (uniq.size !== selections.length) {
          send(ws, {
            type: "VOTE_ACK",
            payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "invalid_selection" },
          } as any);
          return;
        }

        const selectableIds = new Set(activeSelectableSenders(state).map((s) => s.sender_id));
        for (const s of selections) {
          if (!selectableIds.has(s)) {
            send(ws, {
              type: "VOTE_ACK",
              payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: false, reason: "invalid_selection" },
            } as any);
            return;
          }
        }

        const expected = activeClaimedPlayers(state).map((p) => p.player_id);

        const votesByPlayer: Record<string, string[]> = ((state as any).__votesByPlayer ??= {});
        votesByPlayer[myPid] = selections;

        g.votes_received_player_ids = Array.from(new Set([...(g.votes_received_player_ids ?? []), myPid]));

        await repo.setState(room_code, state);

        send(ws, { type: "VOTE_ACK", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, accepted: true } } as any);
        broadcast(room_code, { type: "PLAYER_VOTED", payload: { room_code, round_id: cur.round.round_id, item_id: cur.item.item_id, player_id: myPid } } as any);

        const all = expected.every((pid) => Array.isArray(votesByPlayer[pid]) && votesByPlayer[pid].length === cur.item.k);

        if (!all) {
          broadcastStateFromState(state, room_code);
          return;
        }

        // compute results + scores
        const resultsPlayers = expected.map((pid) => {
          const sel = votesByPlayer[pid] ?? [];
          const correct = sel.filter((s) => cur.item.true_sender_ids.includes(s));
          const incorrect = sel.filter((s) => !cur.item.true_sender_ids.includes(s));
          const points_gained = correct.length;
          const score_total = (state.scores[pid] ?? 0) + points_gained;
          return { player_id: pid, selections: sel, correct, incorrect, points_gained, score_total };
        });

        for (const r of resultsPlayers) state.scores[r.player_id] = r.score_total;

        g.status = "reveal_wait";
        g.current_vote_results = {
          round_id: cur.round.round_id,
          item_id: cur.item.item_id,
          true_senders: cur.item.true_sender_ids,
          players: resultsPlayers,
        };

        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "VOTE_RESULTS",
          payload: { room_code, ...g.current_vote_results },
        } as any);

        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "END_ITEM") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !(state as any).game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));

        const g: any = (state as any).game;
        if (g.status !== "reveal_wait") return send(ws, errorMsg(room_code, "invalid_state", "Not in reveal_wait"));

        const cur = getCurrentSetupItem(state);
        if (!cur) return send(ws, errorMsg(room_code, "invalid_state", "No current item"));

        const nextIndex = (typeof g.current_item_index === "number" ? g.current_item_index : 0) + 1;

        (state as any).__votesByPlayer = {};

        if (nextIndex < cur.round.items.length) {
          g.current_item_index = nextIndex;
          g.status = "idle";
          g.votes_received_player_ids = [];
          g.current_vote_results = undefined;

          const payload = newItemPayload(state);
          if (!payload) return send(ws, errorMsg(room_code, "invalid_state", "No next item"));

          g.item = {
            round_id: payload.round_id,
            item_id: payload.item_id,
            reel: payload.reel,
            k: payload.k,
            senders_selectable: payload.senders_selectable,
          };

          await repo.setState(room_code, state);

          broadcast(room_code, { type: "NEW_ITEM", payload } as any);
          broadcastStateFromState(state, room_code);
          return;
        }

        g.status = "round_recap";
        await repo.setState(room_code, state);

        broadcast(room_code, {
          type: "ROUND_RECAP",
          payload: {
            room_code,
            round_id: cur.round.round_id,
            players: activeClaimedPlayers(state).map((p) => ({
              player_id: p.player_id,
              points_round: 0,
              score_total: state.scores[p.player_id] ?? 0,
            })),
          },
        } as any);

        broadcastStateFromState(state, room_code);
        return;
      }

      if (msg.type === "START_NEXT_ROUND") {
        if (!ctx.is_master) return send(ws, errorMsg(room_code, "not_master", "Master only"));
        if (state.phase !== "game" || !(state as any).game || !state.setup) return send(ws, errorMsg(room_code, "invalid_state", "Not in game"));

        const g: any = (state as any).game;
        if (g.status !== "round_recap") return send(ws, errorMsg(room_code, "invalid_state", "Not in round_recap"));

        const prevRid = g.current_round_id as string | null;
        if (!prevRid) return send(ws, errorMsg(room_code, "invalid_state", "Missing current_round_id"));

        const order = getRoundOrder(state);
        const idx = order.indexOf(prevRid);
        if (idx === -1) return send(ws, errorMsg(room_code, "invalid_state", "Round not found"));

        const nextRid = order[idx + 1] ?? null;

        broadcast(room_code, { type: "ROUND_FINISHED", payload: { room_code, round_id: prevRid } } as any);

        (state as any).__votesByPlayer = {};

        if (!nextRid) {
          state.phase = "game_over";
          await repo.setState(room_code, state);

          broadcast(room_code, {
            type: "GAME_OVER",
            payload: { room_code, ranking: computeRanking(state.scores), scores: state.scores },
          } as any);

          broadcastStateFromState(state, room_code);
          return;
        }

        const nextRound = getSetupRound(state, nextRid);
        if (!nextRound || nextRound.items.length === 0) return send(ws, errorMsg(room_code, "invalid_state", "Next round has no items"));

        g.current_round_id = nextRid;
        g.current_item_index = 0;
        g.status = "idle";
        g.votes_received_player_ids = [];
        g.current_vote_results = undefined;

        const payload = newItemPayload(state);
        if (!payload) return send(ws, errorMsg(room_code, "invalid_state", "No first item"));

        g.item = {
          round_id: payload.round_id,
          item_id: payload.item_id,
          reel: payload.reel,
          k: payload.k,
          senders_selectable: payload.senders_selectable,
        };

        await repo.setState(room_code, state);

        broadcast(room_code, { type: "NEW_ITEM", payload } as any);
        broadcastStateFromState(state, room_code);
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
