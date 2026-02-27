export type RoomCode = string;
export type DeviceId = string;
export type MasterKey = string;

export type PlayerId = string;
export type SenderId = string;
export type RoundId = string;
export type ItemId = string;

export type Phase = "lobby" | "game" | "game_over";

/* ---------------- Setup domain (public subset used in WS) ---------------- */

export type ReelPublic = {
  url: string;
};

/** A reel item inside a round (game-time public view). */
export type RoundItemPublic = {
  round_id: RoundId;
  item_id: ItemId;
  reel: ReelPublic;
  /** K = number of true senders associated to this reel. Defines slot count and max selectable per vote. */
  k: number;
  /** Server status for this item inside the current round. */
  status: "pending" | "voting" | "voted";
  /** Present when status == "voted". Used by Master to render slots-filled state and allow reconnect. */
  revealed_sender_ids?: SenderId[];
};

export type SenderSelectable = {
  sender_id: SenderId;
  name: string;
};

export type PlayerVisible = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;
  active: boolean;
  status: "free" | "taken";
  name: string;
  avatar_url: string | null;
};

export type SenderVisible = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
  avatar_url?: string | null;
};

export type PlayerAll = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;
  active: boolean;
  name: string;
  avatar_url: string | null;
  claimed_by?: DeviceId;
  color?: string;
};

export type SenderAll = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
  avatar_url?: string | null;
  color?: string;
};

/* ---------------- Game sync (server truth) ---------------- */

/** Root game view state. */
export type GameView = "round_active" | "round_score_modal";

/**
 * Round active sub-phase.
 * - waiting: no active item; master can open any pending item.
 * - voting: vote open for active_item_id.
 */
export type RoundActivePhase = "waiting" | "voting";

export type GameVotingState = {
  round_id: RoundId;
  item_id: ItemId;
  /** Players snapshot at vote start (players_in_game). */
  expected_player_ids: PlayerId[];
  votes_received_player_ids: PlayerId[];
  /** If set, vote is scheduled to close automatically at this UNIX ms timestamp. */
  force_close_ends_at_ms?: number;
};

export type VoteResultPerPlayer = {
  player_id: PlayerId;
  selections: SenderId[];
  correct: SenderId[];
  incorrect: SenderId[];
  missing: SenderId[];
  points_gained: number;
  score_total: number;
};

export type VoteResultsPublic = {
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: VoteResultPerPlayer[];
};

export type GamePlayersInGame = Array<{
  player_id: PlayerId;
  name: string;
  avatar_url: string | null;
  /** Stable color assigned at START_GAME (used for placeholders + player<->sender mapping). */
  color: string;
  /** Optional binding to a sender. */
  sender_id: SenderId | null;
}>;

export type GameSendersInGame = Array<{
  sender_id: SenderId;
  name: string;
  avatar_url: string | null;
  color: string;
}>;

export type GameRoundActiveState = {
  view: "round_active";
  phase: RoundActivePhase;
  current_round_id: RoundId;
  /**
   * In waiting: null
   * In voting: item_id being voted
   */
  active_item_id: ItemId | null;
  /** Full round grid for Master rendering (URL + slots). */
  items: RoundItemPublic[];
  /** Voting state only when phase == "voting" */
  voting?: GameVotingState;
};

export type GameRoundScoreModalState = {
  view: "round_score_modal";
  current_round_id: RoundId;
  /** True if this modal is the final one (no rounds remaining). */
  game_over: boolean;
  ranking: Array<{ player_id: PlayerId; score_total: number; rank: number }>;
};

export type GameStateSync = {
  view: GameView;
  players_in_game: GamePlayersInGame;
  senders_in_game: GameSendersInGame;
  /** Present if view == round_active */
  round_active?: GameRoundActiveState;
  /** Present if view == round_score_modal */
  round_score_modal?: GameRoundScoreModalState;
  /**
   * Master-only cache of the last computed results for the active item.
   * Useful for reconnect during reveal animations.
   */
  last_vote_results?: VoteResultsPublic;
};

/* ---------------- WS State Sync payload ---------------- */

export type StateSyncRes = {
  room_code: RoomCode;
  phase: Phase;
  setup_ready: boolean;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  players_all?: PlayerAll[];
  senders_all?: SenderAll[];

  my_player_id: PlayerId | null;

  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
};
