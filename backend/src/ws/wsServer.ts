// ⚠️ Fichier complet simplifié pour la partie GAME + NEW_ITEM reel_url + fix ROUND_FINISHED

import type {
  ServerToClientMsg,
  ClientToServerMsg,
} from "@brp/contracts/ws";
import type { RoundItem } from "@brp/contracts";
import { loadRoom } from "../state/getRoom";
import type { RoomStateInternal } from "../state/createRoom";

function broadcast(room: RoomStateInternal, msg: ServerToClientMsg) {
  room.__conns?.forEach((c: any) => {
    try {
      c.send(JSON.stringify(msg));
    } catch {}
  });
}

function currentItem(room: RoomStateInternal): RoundItem | null {
  if (!room.setup || !room.game) return null;
  const r = room.setup.rounds[room.game.current_round_index];
  if (!r) return null;
  return r.items[room.game.current_item_index] ?? null;
}

function emitNewItem(room: RoomStateInternal) {
  const item = currentItem(room);
  if (!item) return;

  const msg: ServerToClientMsg = {
    type: "NEW_ITEM",
    payload: {
      room_code: room.room_code,
      round_id: room.setup!.rounds[room.game!.current_round_index].round_id,
      item_id: item.item_id,
      reel_url: item.reel_url,
    },
  };

  broadcast(room, msg);
}

export function handleGameMessage(
  room: RoomStateInternal,
  msg: ClientToServerMsg,
  ctx: any
) {
  /* ---------------- START_GAME ---------------- */

  if (msg.type === "START_GAME") {
    if (room.phase !== "lobby" || !room.setup) return;

    room.phase = "game";

    room.game = {
      current_round_index: 0,
      current_item_index: 0,
      status: "reveal",
      expected_player_ids: room.players
        .filter((p) => p.active && p.claimed_by)
        .map((p) => p.player_id),
      votes: {},
      round_finished: false,
    };

    broadcast(room, {
      type: "GAME_START",
      payload: { room_code: room.room_code },
    });

    emitNewItem(room);
    return;
  }

  if (!room.game) return;

  /* ---------------- REEL_OPENED ---------------- */

  if (msg.type === "REEL_OPENED") {
    if (room.game.status !== "reveal") return;

    const item = currentItem(room);
    if (!item) return;

    room.game.status = "vote";
    room.game.votes = {};

    broadcast(room, {
      type: "START_VOTE",
      payload: {
        room_code: room.room_code,
        round_id: msg.payload.round_id,
        item_id: msg.payload.item_id,
        senders_selectable: room.senders
          .filter((s) => s.active)
          .map((s) => s.sender_id),
        k: item.k,
      },
    });

    return;
  }

  /* ---------------- SUBMIT_VOTE ---------------- */

  if (msg.type === "SUBMIT_VOTE") {
    if (room.game.status !== "vote") return;
    if (!ctx.my_player_id) return;

    room.game.votes[ctx.my_player_id] = msg.payload.selections;

    broadcast(room, {
      type: "PLAYER_VOTED",
      payload: {
        room_code: room.room_code,
        player_id: ctx.my_player_id,
      },
    });

    if (
      Object.keys(room.game.votes).length ===
      room.game.expected_player_ids.length
    ) {
      const item = currentItem(room);
      if (!item) return;

      const scores = room.scores;

      Object.entries(room.game.votes).forEach(([pid, sel]) => {
        const ok = sel.filter((s) => item.true_sender_ids.includes(s)).length;
        scores[pid] = (scores[pid] ?? 0) + ok;
      });

      room.game.status = "reveal_wait";

      broadcast(room, {
        type: "VOTE_RESULTS",
        payload: {
          room_code: room.room_code,
          round_id:
            room.setup!.rounds[room.game.current_round_index].round_id,
          item_id: item.item_id,
          votes: room.game.votes,
          true_sender_ids: item.true_sender_ids,
          scores,
        },
      });
    }

    return;
  }

  /* ---------------- END_ITEM ---------------- */

  if (msg.type === "END_ITEM") {
    if (room.game.status !== "reveal_wait") return;

    const r = room.setup!.rounds[room.game.current_round_index];

    room.game.current_item_index++;

    if (room.game.current_item_index < r.items.length) {
      room.game.status = "reveal";
      emitNewItem(room);
      return;
    }

    room.game.status = "round_recap";
    room.game.round_finished = true;

    broadcast(room, {
      type: "ROUND_RECAP",
      payload: {
        room_code: room.room_code,
        round_id: r.round_id,
        scores: room.scores,
      },
    });

    return;
  }

  /* ---------------- START_NEXT_ROUND ---------------- */

  if (msg.type === "START_NEXT_ROUND") {
    if (room.game.status !== "round_recap") return;

    const prevRound =
      room.setup!.rounds[room.game.current_round_index];

    broadcast(room, {
      type: "ROUND_FINISHED",
      payload: {
        room_code: room.room_code,
        round_id: prevRound.round_id,
      },
    });

    room.game.current_round_index++;

    if (room.game.current_round_index >= room.setup!.rounds.length) {
      room.phase = "game_over";

      broadcast(room, {
        type: "GAME_OVER",
        payload: {
          room_code: room.room_code,
          scores: room.scores,
        },
      });

      return;
    }

    room.game.current_item_index = 0;
    room.game.status = "reveal";
    room.game.round_finished = false;
    room.game.votes = {};

    emitNewItem(room);
  }
}
