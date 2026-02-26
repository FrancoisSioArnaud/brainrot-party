import type { RoomMeta } from "./roomRepo.js";
import { genMasterKey, genRoomCode } from "../utils/ids.js";
import { sha256Hex } from "../utils/hash.js";
import { PROTOCOL_VERSION } from "@brp/contracts";
import type { SenderAll, PlayerAll, Phase, GameStateSync, PlayerId, SenderId } from "@brp/contracts";

export type SetupItem = {
  item_id: string;
  reel: { reel_id: string; url: string };
  k: number;
  true_sender_ids: string[];
};
export type SetupRound = {
  round_id: string;
  items: SetupItem[];
};

export type RoomStateInternal = {
  room_code: string;
  phase: Phase;
  players: PlayerAll[];
  senders: SenderAll[];

  setup:
    | {
        protocol_version: number;
        seed: string;
        k_max: number;
        rounds: SetupRound[];
        round_order: string[];
        metrics: Record<string, unknown>;
      }
    | null;

  /**
   * Server source-of-truth for game progression.
   * Null until START_GAME.
   */
  game: GameStateSync | null;

  /**
   * Internal votes store for current item.
   * Cleared on START_VOTE, NEW_ITEM, END_ITEM, START_NEXT_ROUND.
   */
  votes_by_player?: Record<PlayerId, SenderId[]>;

  scores: Record<string, number>;
};

export function buildNewRoom(): {
  code: string;
  masterKey: string;
  meta: RoomMeta;
  state: RoomStateInternal;
} {
  const code = genRoomCode(6);
  const masterKey = genMasterKey();
  const now = Date.now();

  // Players are created from Setup senders (MVP invariant).
  // Before setup is posted, the lobby has no claimable players.
  const players: PlayerAll[] = [];

  const state: RoomStateInternal = {
    room_code: code,
    phase: "lobby",
    players,
    senders: [],
    setup: null,
    game: null,
    votes_by_player: {},
    scores: {},
  };

  const meta: RoomMeta = {
    room_code: code,
    created_at: now,
    expires_at: now + 86400_000,
    master_hash: sha256Hex(masterKey),
    protocol_version: PROTOCOL_VERSION,
  };

  return { code, masterKey, meta, state };
}
