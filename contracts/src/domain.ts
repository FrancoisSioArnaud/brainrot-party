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
};

export type PlayerAll = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;
  active: boolean;
  name: string;
  avatar_url: string | null;
  claimed_by?: DeviceId;
};

export type SenderAll = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
};

/* ---------------- Game sync (server truth) ---------------- */

export type GameStatus = "idle" | "reveal" | "vote" | "reveal_wait" | "round_recap";

export type GameItemSync = {
  round_id: RoundId;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  senders_selectable: SenderSelectable[];
};

export type VoteResultPerPlayer = {
  player_id: PlayerId;
  selections: SenderId[];
  correct: SenderId[];
  incorrect: SenderId[];
  points_gained: number;
  score_total: number;
};

export type VoteResultsPublic = {
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: VoteResultPerPlayer[];
};

export type GameStateSync = {
  current_round_id: RoundId | null;
  current_item_index: number;
  status: GameStatus;
  item: GameItemSync | null;
  votes_received_player_ids: PlayerId[];
  current_vote_results?: VoteResultsPublic;
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
