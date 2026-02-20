import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { getGame, saveGame, GameState } from "../state/gameStore";
import {
  getCurrentItem,
  getCurrentRound,
  remainingSendersForRound,
  allActivePlayersVoted,
  scoreForPlayerSelection,
  computeCorrectness,
} from "../state/gameLogic";

type Conn = { ws: WebSocket; role: "master" | "play" };
const connsByRoom = new Map<string, Set<Conn>>();

function send(ws: WebSocket, msg: any) {
  ws.send(JSON.stringify(msg));
}
function broadcast(room_code: string, msg: any) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  for (const c of set) {
    try { c.ws.send(JSON.stringify(msg)); } catch {}
  }
}
function addConn(room_code: string, c: Conn) {
  const set = connsByRoom.get(room_code) || new Set<Conn>();
  set.add(c);
  connsByRoom.set(room_code, set);
}
function removeConn(room_code: string, c: Conn) {
  const set = connsByRoom.get(room_code);
  if (!set) return;
  set.delete(c);
  if (set.size === 0) connsByRoom.delete(room_code);
}

function now() { return Date.now(); }

function toStateSync(state: GameState) {
  const round = getCurrentRound(state);
  const item = getCurrentItem(state);
  const remaining = remainingSendersForRound(state);

  const reelById = new Map(state.reel_items.map(r => [r.id, r]));

  return {
    room_code: state.room_code,
    phase: state.phase,
    current_phase: state.current_phase,
    current_round_index: state.current_round_index,
    current_item_index: state.current_item_index,
    timer_end_ts: state.timer_end_ts,

    senders: state.senders,
    players: state.players,

    round: round
      ? {
          index: round.index,
          items: round.items.map((it) => ({
            id: it.id,
            k: it.k,
            resolved: it.resolved,
            opened: it.opened,
            order_index: it.order_index,
            reel_url: reelById.get(it.reel_item_id)?.url || null
          })),
        }
      : null,

    focus_item: item
      ? {
          id: item.id,
          k: item.k,
          opened: item.opened,
          resolved: item.resolved,
          reel_url: reelById.get(item.reel_item_id)?.url || null
        }
      : null,

    remaining_senders: remaining,
    votes_for_focus: item ? state.votes[item.id] || {} : {},
  };
}

async function startRevealSequence(game: GameState) {
  const item = getCurrentItem(game);
  if (!item) return;

  game.current_phase = "REVEAL_SEQUENCE";
  game.timer_end_ts = null;
  await saveGame(game);

  const votesByPlayer = game.votes[item.id] || {};
  broadcast(game.room_code, { type: "reveal_step", ts: now(), payload: { step: 1, votes_by_player: votesByPlayer } });

  setTimeout(async () => {
    const g = await getGame(game.room_code);
    if (!g) return;
    const it = getCurrentItem(g);
    if (!it) return;
    broadcast(g.room_code, { type: "reveal_step", ts: now(), payload: { step: 2, truth_sender_ids: it.truth_sender_ids } });
  }, 1000);

  setTimeout(async () => {
    const g = await getGame(game.room_code);
    if (!g) return;
    const it = getCurrentItem(g);
    if (!it) return;
    const votes = g.votes[it.id] || {};
    const correctness: Record<string, Record<string, boolean>> = {};
    for (const [pid, sel] of Object.entries(votes)) {
      correctness[pid] = computeCorrectness(it.truth_sender_ids, sel || []);
    }
    broadcast(g.room_code, { type: "reveal_step", ts: now(), payload: { step: 3, correctness_by_player_sender: correctness } });
  }, 2000);

  setTimeout(async () => {
    const g = await getGame(game.room_code);
    if (!g) return;
    const it = getCurrentItem(g);
    if (!it) return;

    const votes = g.votes[it.id] || {};
    for (const p of g.players) {
      if (!p.active) continue;
      const sel = votes[p.id] || [];
      p.score += scoreForPlayerSelection(it.truth_sender_ids, sel);
    }

    await saveGame(g);
    broadcast(g.room_code, { type: "score_update", ts: now(), payload: { players: g.players } });
    broadcast(g.room_code, { type: "reveal_step", ts: now(), payload: { step: 4 } });
  }, 3000);

  setTimeout(async () => {
    const g = await getGame(game.room_code);
    if (!g) return;
    const it = getCurrentItem(g);
    if (!it) return;

    it.resolved = true;
    await saveGame(g);

    broadcast(g.room_code, { type: "reveal_step", ts: now(), payload: { step: 5, truth_sender_ids: it.truth_sender_ids } });
  }, 4000);

  setTimeout(async () => {
    const g = await getGame(game.room_code);
    if (!g) return;

    broadcast(g.room_code, { type: "reveal_step", ts: now(), payload: { step: 6 } });

    // advance item/round/game
    const r = getCurrentRound(g);
    if (!r) return;

    const allResolved = r.items.every((x) => x.resolved);
    if (allResolved) {
      g.current_phase = "ROUND_COMPLETE";
      await saveGame(g);
      broadcast(g.room_code, { type: "round_complete", ts: now(), payload: { round_index: g.current_round_index } });

      if (g.current_round_index + 1 >= g.rounds.length) {
        g.phase = "GAME_END";
        g.current_phase = "GAME_END";
        await saveGame(g);
        broadcast(g.room_code, { type: "game_end", ts: now(), payload: { players: g.players } });
        broadcast(g.room_code, { type: "state_sync", ts: now(), payload: toStateSync(g) });
        return;
      }

      g.current_round_index += 1;
      g.current_item_index = 0;
      g.current_phase = "ROUND_INIT";
      await saveGame(g);

      broadcast(g.room_code, { type: "round_started", ts: now(), payload: { round_index: g.current_round_index } });
      broadcast(g.room_code, { type: "state_sync", ts: now(), payload: toStateSync(g) });
      return;
    }

    g.current_item_index += 1;
    g.current_phase = "ROUND_INIT";
    await saveGame(g);

    broadcast(g.room_code, { type: "item_completed", ts: now(), payload: {} });
    broadcast(g.room_code, { type: "focus_changed", ts: now(), payload: { current_item_index: g.current_item_index } });
    broadcast(g.room_code, { type: "state_sync", ts: now(), payload: toStateSync(g) });
  }, 5000);
}

async function closeVotingAndReveal(game: GameState, reason: "all_voted" | "timer_end") {
  const item = getCurrentItem(game);
  if (!item) return;

  game.current_phase = "REVEAL_SEQUENCE";
  game.timer_end_ts = null;
  await saveGame(game);

  broadcast(game.room_code, { type: "voting_closed", ts: now(), payload: { reason } });
  await startRevealSequence(game);
}

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = String((req.query as any).role || "play") as "master" | "play";
    const c: Conn = { ws: conn.socket, role };

    addConn(room_code, c);

    async function sync(ws: WebSocket) {
      const g = await getGame(room_code);
      if (!g) {
        send(ws, { type: "error", ts: now(), payload: { code: "ROOM_NOT_FOUND", message: "Room introuvable" } });
        return;
      }
      send(ws, { type: "state_sync", ts: now(), payload: toStateSync(g) });
    }

    conn.socket.on("message", async (raw) => {
      let msg: any = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg?.type) return;

      const game = await getGame(room_code);
      if (!game) {
        send(conn.socket, { type: "error", ts: now(), payload: { code: "ROOM_NOT_FOUND", message: "Room introuvable" } });
        return;
      }

      if (msg.type === "master_ready" || msg.type === "play_ready") {
        await sync(conn.socket);
        return;
      }

      if (msg.type === "open_reel") {
        if (role !== "master") return;
        const item = getCurrentItem(game);
        if (!item || item.resolved) return;

        item.opened = true;
        game.current_phase = "OPEN_REEL";
        await saveGame(game);

        broadcast(room_code, { type: "reel_opened", ts: now(), payload: { item_id: item.id } });
        broadcast(room_code, { type: "state_sync", ts: now(), payload: toStateSync(game) });
        return;
      }

      if (msg.type === "start_voting") {
        if (role !== "master") return;
        const item = getCurrentItem(game);
        if (!item || item.resolved) return;

        game.current_phase = "VOTING";
        game.timer_end_ts = null;
        await saveGame(game);

        broadcast(room_code, {
          type: "voting_started",
          ts: now(),
          payload: {
            item_id: item.id,
            k: item.k,
            senders_active: game.senders.filter((s) => s.active).map((s) => ({ id_local: s.id_local, name: s.name })),
          },
        });
        broadcast(room_code, { type: "state_sync", ts: now(), payload: toStateSync(game) });
        return;
      }

      if (msg.type === "start_timer") {
        if (role !== "master") return;
        const { duration } = msg.payload || {};
        const seconds = Number(duration || 10);
        const ends = now() + seconds * 1000;

        game.current_phase = "TIMER_RUNNING";
        game.timer_end_ts = ends;
        await saveGame(game);

        broadcast(room_code, { type: "timer_started", ts: now(), payload: { ends_at: ends } });
        broadcast(room_code, { type: "state_sync", ts: now(), payload: toStateSync(game) });

        setTimeout(async () => {
          const g = await getGame(room_code);
          if (!g) return;
          if (g.timer_end_ts && now() >= g.timer_end_ts && (g.current_phase === "TIMER_RUNNING" || g.current_phase === "VOTING")) {
            await closeVotingAndReveal(g, "timer_end");
          }
        }, seconds * 1000 + 20);

        return;
      }

      if (msg.type === "cast_vote") {
        const { player_id, sender_ids } = msg.payload || {};
        const pid = String(player_id || "");
        const item = getCurrentItem(game);
        if (!item) return;

        if (!(game.current_phase === "VOTING" || game.current_phase === "TIMER_RUNNING")) {
          send(conn.socket, { type: "ack", ts: now(), payload: { ok: false, error: "VOTING_CLOSED" } });
          return;
        }

        const p = game.players.find((x) => x.id === pid);
        if (!p || !p.active) {
          send(conn.socket, { type: "ack", ts: now(), payload: { ok: false, error: "PLAYER_INVALID" } });
          return;
        }

        const activeSenders = new Set(game.senders.filter((s) => s.active).map((s) => s.id_local));
        const sel = Array.isArray(sender_ids) ? sender_ids.map(String) : [];
        const cleaned = [...new Set(sel)].filter((x) => activeSenders.has(x)).slice(0, item.k);

        game.votes[item.id] = game.votes[item.id] || {};
        game.votes[item.id][pid] = cleaned;
        await saveGame(game);

        send(conn.socket, { type: "vote_cast", ts: now(), payload: { ok: true } });
        broadcast(room_code, { type: "vote_received", ts: now(), payload: { player_id: pid } });
        broadcast(room_code, { type: "state_sync", ts: now(), payload: toStateSync(game) });

        if (allActivePlayersVoted(game, item.id)) {
          await closeVotingAndReveal(game, "all_voted");
        }
        return;
      }

      if (msg.type === "force_close_voting") {
        if (role !== "master") return;
        await closeVotingAndReveal(game, "timer_end");
        return;
      }
    });

    conn.socket.on("close", () => removeConn(room_code, c));

    await sync(conn.socket);
  });
}
