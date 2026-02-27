// contracts/src/domain.ts

export type RoomCode = string;
export type DeviceId = string;
export type MasterKey = string;

export type PlayerId = string;
export type SenderId = string;
export type RoundId = string;
export type ItemId = string;

export type Phase = "lobby" | "game" | "game_over";

/* ---------------- Round / Items (game-time public view) ---------------- */

export type ReelPublic = {
  /** Raw URL only (as decided). */
  url: string;
};

/**
 * Item inside a round.
 * - k = number of true senders associated to this reel (slot count + max selectable per vote).
 * - status is server-truth for progress within the current round.
 */
export type RoundItemPublic = {
  round_id: RoundId;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  status: "pending" | "voting" | "voted";
  /** Present when status == "voted" (used for master grid persistence / reconnect). */
  revealed_sender_ids?: SenderId[];
};

/* ---------------- Lobby visible domain ---------------- */

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

/** Master-only richer view (optional fields; used in lobby). */
export type PlayerAll = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;

  active: boolean;
  name: string;
  avatar_url: string | null;

  claimed_by?: DeviceId;

  /** Assigned at START_GAME and persisted (optional in lobby). */
  color?: string;
};

/** Master-only richer view (optional fields; used in lobby). */
export type SenderAll = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
  avatar_url?: string | null;

  /** Assigned at START_GAME and persisted (optional in lobby). */
  color?: string;
};

/* ---------------- Game sync (server truth) ---------------- */

export type GameView = "round_active" | "round_score_modal";

/**
 * Round active sub-phase.
 * - waiting: no active item; master can open any pending item
 * - voting: vote open for active_item_id
 */
export type RoundActivePhase = "waiting" | "voting";

export type GameVotingState = {
  round_id: RoundId;
  item_id: ItemId;

  /**
   * Snapshot at vote start (players_in_game).
   * No filtering needed after START_GAME (players are already "in_game").
   */
  expected_player_ids: PlayerId[];

  votes_received_player_ids: PlayerId[];

  /**
   * If set, vote is scheduled to close automatically at this UNIX ms timestamp.
   * Set when master triggers FORCE_CLOSE_VOTE (10s countdown).
   */
  force_close_ends_at_ms?: number;
};

export type VoteResultPerPlayer = {
  player_id: PlayerId;

  /** Player selections sent (0..K). */
  selections: SenderId[];

  /** Derived by server for reveal clarity. */
  correct: SenderId[];
  incorrect: SenderId[];
  missing: SenderId[];

  points_gained: number;
  score_total: number;
};

export type VoteResultsPublic = {
  round_id: RoundId;
  item_id: ItemId;

  /** True sender(s) for this item. */
  true_senders: SenderId[];

  players: VoteResultPerPlayer[];
};

/**
 * Snapshot lists "in game", frozen at START_GAME:
 * - players_in_game: active at start
 * - senders_in_game: validated at setup/lobby
 */
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

  /** True if this is the final modal (no rounds remaining). */
  game_over: boolean;

  ranking: Array<{ player_id: PlayerId; score_total: number; rank: number }>;
};

export type GameStateSync = {
  view: GameView;

  players_in_game: GamePlayersInGame;
  senders_in_game: GameSendersInGame;

  /** Present if view == "round_active" */
  round_active?: GameRoundActiveState;

  /** Present if view == "round_score_modal" */
  round_score_modal?: GameRoundScoreModalState;

  /**
   * Master-only cache of the last computed results.
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

  /** Present only if master_key is valid. */
  players_all?: PlayerAll[];
  /** Present only if master_key is valid. */
  senders_all?: SenderAll[];

  /** For Play: claimed slot id (if any). */
  my_player_id: PlayerId | null;

  /** Present when phase == "game" or "game_over". */
  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
};
