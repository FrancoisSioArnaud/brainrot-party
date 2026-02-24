// contracts/src/domain.ts
export type RoomCode = string;
export type DeviceId = string;
export type MasterKey = string;

export type PlayerId = string;
export type SenderId = string;
export type RoundId = string;
export type ItemId = string;
export type ReelId = string;

export type Phase = "lobby" | "game" | "game_over";
export type PlayerStatus = "free" | "taken";
export type GameStatus = "idle" | "vote" | "reveal_wait" | "round_recap";

export interface PlayerVisible {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;
  active: boolean;
  status: PlayerStatus;
  name: string;
  avatar_url: string | null;
}

export interface PlayerAll {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;
  active: boolean;
  name: string;
  avatar_url: string | null;
  claimed_by?: DeviceId;
}

export interface SenderVisible {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
}

export interface SenderAll {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
}

export interface SenderSelectable {
  sender_id: SenderId;
  name: string;
}

export interface ReelPublic {
  reel_id: ReelId;
  url: string;
}

/* ---------- Vote results (domain, public) ---------- */

export interface VoteResultPerPlayer {
  player_id: PlayerId;
  selections: SenderId[];
  correct: SenderId[];
  incorrect: SenderId[];
  points_gained: number;
  score_total: number;
}

export interface VoteResultsPublic {
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: VoteResultPerPlayer[];
}

/* ---------- Game sync (domain) ---------- */

export interface GameStateSyncItem {
  round_id: RoundId;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  senders_selectable: SenderSelectable[];
}

export interface GameStateSync {
  current_round_id: RoundId | null;
  current_item_index: number | null;
  status: GameStatus;
  item: GameStateSyncItem | null;

  /** Master-only (conn.is_master=true) and only meaningful when status=vote */
  votes_received_player_ids?: PlayerId[];

  /** Master-only (conn.is_master=true) and only meaningful when status=reveal_wait */
  current_vote_results?: VoteResultsPublic;
}

/* ---------- State sync (domain) ---------- */

export interface StateSyncRes {
  room_code: RoomCode;
  phase: Phase;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  players_all?: PlayerAll[];
  senders_all?: SenderAll[];

  my_player_id: PlayerId | null;
  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
}
