// ws/messages.ts


import { PROTOCOL_VERSION } from "../version";

/* ---------------------------------- */
/* Shared primitives                   */
/* ---------------------------------- */

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

/* ---------------------------------- */
/* Models (public)                     */
/* ---------------------------------- */

export interface PlayerVisible {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;

  /** Whether the slot is active (can participate). */
  active: boolean;

  /** Derived from claims (server). */
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
  claimed_by?: DeviceId; // master-only debug/ops
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

/* ---------------------------------- */
/* Envelope                            */
/* ---------------------------------- */

export interface WsEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

/* ---------------------------------- */
/* Errors                              */
/* ---------------------------------- */

export type ErrorCode =
  | "room_not_found"
  | "room_expired"
  | "invalid_protocol_version"
  | "invalid_payload"
  | "forbidden"
  | "not_master"
  | "not_in_phase"
  | "not_claimed"
  | "conflict"
  | "player_not_found"
  | "player_inactive"
  | "player_taken"
  | "vote_closed"
  | "already_voted"
  | "internal_error";

export interface ErrorRes {
  room_code?: RoomCode;
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}
export type ErrorMsg = WsEnvelope<"ERROR", ErrorRes>;

/* ---------------------------------- */
/* Requests — Join / Session           */
/* ---------------------------------- */

/**
 * The only message that carries:
 * - room_code
 * - device_id
 * - optional master_key (to elevate connection to master)
 * - protocol_version
 *
 * After JOIN_ROOM:
 * - server binds socket to room
 * - server stores device_id in connection context
 * - server sets conn.is_master based on master_key validation
 */
export interface JoinRoomReq {
  room_code: RoomCode;
  device_id: DeviceId;
  protocol_version: number; // must equal PROTOCOL_VERSION
  master_key?: MasterKey; // optional; if valid => conn.is_master=true
}
export type JoinRoomMsg = WsEnvelope<"JOIN_ROOM", JoinRoomReq>;

/**
 * Client can request a fresh full sync at any time.
 * Server should also push STATE_SYNC_RESPONSE on:
 * - join/reconnect
 * - any mutation
 */
export type RequestSyncMsg = WsEnvelope<"REQUEST_SYNC", {}>;

/* ---------------------------------- */
/* Requests — Master (room-bound)      */
/* ---------------------------------- */

export interface TogglePlayerReq {
  player_id: PlayerId;
  active: boolean;
}
export type TogglePlayerMsg = WsEnvelope<"TOGGLE_PLAYER", TogglePlayerReq>;

export type StartGameMsg = WsEnvelope<"START_GAME", {}>;

export interface ReelOpenedReq {
  round_id: RoundId;
  item_id: ItemId;
}
export type ReelOpenedMsg = WsEnvelope<"REEL_OPENED", ReelOpenedReq>;

export interface EndItemReq {
  round_id: RoundId;
  item_id: ItemId;
}
export type EndItemMsg = WsEnvelope<"END_ITEM", EndItemReq>;

export type StartNextRoundMsg = WsEnvelope<"START_NEXT_ROUND", {}>;

export type RoomClosedMsg = WsEnvelope<"ROOM_CLOSED", {}>;

/* ---------------------------------- */
/* Requests — Play (room-bound)        */
/* ---------------------------------- */

export interface TakePlayerReq {
  player_id: PlayerId;
}
export type TakePlayerMsg = WsEnvelope<"TAKE_PLAYER", TakePlayerReq>;

export interface RenamePlayerReq {
  new_name: string;
}
export type RenamePlayerMsg = WsEnvelope<"RENAME_PLAYER", RenamePlayerReq>;

export interface UpdateAvatarReq {
  /** base64 or data URL */
  image: string;
}
export type UpdateAvatarMsg = WsEnvelope<"UPDATE_AVATAR", UpdateAvatarReq>;

export interface SubmitVoteReq {
  round_id: RoundId;
  item_id: ItemId;
  selections: SenderId[]; // must be exactly k, unique
}
export type SubmitVoteMsg = WsEnvelope<"SUBMIT_VOTE", SubmitVoteReq>;

/* ---------------------------------- */
/* Responses / Pushes                  */
/* ---------------------------------- */

export interface JoinOkRes {
  room_code: RoomCode;
  phase: Phase;
  protocol_version: number; // echoes server version (PROTOCOL_VERSION)
}
export type JoinOkMsg = WsEnvelope<"JOIN_OK", JoinOkRes>;

export interface TakePlayerOkRes {
  room_code: RoomCode;
  my_player_id: PlayerId;
}
export type TakePlayerOkMsg = WsEnvelope<"TAKE_PLAYER_OK", TakePlayerOkRes>;

export interface TakePlayerFailRes {
  room_code: RoomCode;
  player_id: PlayerId;
  reason: "taken_now" | "inactive" | "device_already_has_player";
}
export type TakePlayerFailMsg = WsEnvelope<"TAKE_PLAYER_FAIL", TakePlayerFailRes>;

export interface PlayerUpdateRes {
  room_code: RoomCode;
  player: PlayerVisible;
  sender_updated?: SenderVisible;
}
export type PlayerUpdateMsg = WsEnvelope<"PLAYER_UPDATE", PlayerUpdateRes>;

export interface SlotInvalidatedRes {
  room_code: RoomCode;
  player_id: PlayerId;
  reason: "disabled_or_deleted";
}
export type SlotInvalidatedMsg = WsEnvelope<"SLOT_INVALIDATED", SlotInvalidatedRes>;

export interface GameStartRes {
  room_code: RoomCode;
}
export type GameStartMsg = WsEnvelope<"GAME_START", GameStartRes>;

export interface NewItemRes {
  room_code: RoomCode;
  round_id: RoundId;
  item_index: number;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  senders_selectable: SenderSelectable[];
  slots_total: number;
}
export type NewItemMsg = WsEnvelope<"NEW_ITEM", NewItemRes>;

export interface StartVoteRes {
  room_code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  k: number;
  senders_selectable: SenderSelectable[];
}
export type StartVoteMsg = WsEnvelope<"START_VOTE", StartVoteRes>;

export interface VoteAckRes {
  room_code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  accepted: boolean;
  reason?:
    | "invalid_selection"
    | "late"
    | "too_many"
    | "not_in_vote"
    | "not_claimed"
    | "not_expected_voter";
}
export type VoteAckMsg = WsEnvelope<"VOTE_ACK", VoteAckRes>;

export interface PlayerVotedRes {
  room_code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  player_id: PlayerId;
}
export type PlayerVotedMsg = WsEnvelope<"PLAYER_VOTED", PlayerVotedRes>;

export interface VoteResultPerPlayer {
  player_id: PlayerId;
  selections: SenderId[];
  correct: SenderId[];
  incorrect: SenderId[];
  points_gained: number;
  score_total: number;
}

export interface VoteResultsRes {
  room_code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: VoteResultPerPlayer[];
}
export type VoteResultsMsg = WsEnvelope<"VOTE_RESULTS", VoteResultsRes>;

export interface RoundRecapPerPlayer {
  player_id: PlayerId;
  points_round: number;
  score_total: number;
}

export interface RoundRecapRes {
  room_code: RoomCode;
  round_id: RoundId;
  players: RoundRecapPerPlayer[];
}
export type RoundRecapMsg = WsEnvelope<"ROUND_RECAP", RoundRecapRes>;

export interface RoundFinishedRes {
  room_code: RoomCode;
  round_id: RoundId;
}
export type RoundFinishedMsg = WsEnvelope<"ROUND_FINISHED", RoundFinishedRes>;

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
  current_vote_results?: Omit<VoteResultsRes, "room_code">;
}

export interface StateSyncRes {
  room_code: RoomCode;
  phase: Phase;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  /** Master-only (conn.is_master=true) */
  players_all?: PlayerAll[];
  /** Master-only (conn.is_master=true) */
  senders_all?: SenderAll[];

  /** Derived from claim (conn context) */
  my_player_id: PlayerId | null;

  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
}
export type StateSyncResponseMsg = WsEnvelope<"STATE_SYNC_RESPONSE", StateSyncRes>;

export interface RankingEntry {
  player_id: PlayerId;
  score_total: number;
  rank: number;
}

export interface GameOverRes {
  room_code: RoomCode;
  ranking: RankingEntry[];
  scores: Record<PlayerId, number>;
}
export type GameOverMsg = WsEnvelope<"GAME_OVER", GameOverRes>;

export interface RoomClosedBroadcastRes {
  room_code: RoomCode;
  reason: "closed_by_master";
}
export type RoomClosedBroadcastMsg = WsEnvelope<
  "ROOM_CLOSED_BROADCAST",
  RoomClosedBroadcastRes
>;

/* ---------------------------------- */
/* Unions                              */
/* ---------------------------------- */

// Client -> Server
export type ClientToServerMsg =
  | JoinRoomMsg
  | RequestSyncMsg
  // Master
  | TogglePlayerMsg
  | StartGameMsg
  | ReelOpenedMsg
  | EndItemMsg
  | StartNextRoundMsg
  | RoomClosedMsg
  // Play
  | TakePlayerMsg
  | RenamePlayerMsg
  | UpdateAvatarMsg
  | SubmitVoteMsg;

// Server -> Client
export type ServerToClientMsg =
  | JoinOkMsg
  | ErrorMsg
  | TakePlayerOkMsg
  | TakePlayerFailMsg
  | PlayerUpdateMsg
  | SlotInvalidatedMsg
  | GameStartMsg
  | NewItemMsg
  | StartVoteMsg
  | VoteAckMsg
  | PlayerVotedMsg
  | VoteResultsMsg
  | RoundRecapMsg
  | RoundFinishedMsg
  | StateSyncResponseMsg
  | GameOverMsg
  | RoomClosedBroadcastMsg;

/* ---------------------------------- */
/* Runtime helper (optional)           */
/* ---------------------------------- */

export function isProtocolVersionSupported(v: number): boolean {
  return v === PROTOCOL_VERSION;
}
