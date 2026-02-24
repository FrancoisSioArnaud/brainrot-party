// ws/messages.ts
//
// Includes:
// - STATE_SYNC supports master_key?
// - STATE_SYNC_RESPONSE always includes players_visible/senders_visible
// - If master_key valid -> includes players_all/senders_all
// - If game.status=vote -> includes votes_received_player_ids (master only)
// - If game.status=reveal_wait -> includes current_vote_results (master only)
// - Uses game.current_vote (not game.vote)
//
// Notes:
// - No thumb_url
// - No partial items
// - device_id only
// - master_key returned by CREATE_ROOM, stored hashed in Redis meta

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

export type Phase = "lobby" | "game" | "over";
export type PlayerStatus = "free" | "taken";
export type GameStatus = "idle" | "vote" | "reveal_wait" | "round_recap";

/* ---------------------------------- */
/* Models (public)                     */
/* ---------------------------------- */

export interface PlayerVisible {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;

  /** Only active players are "visible". */
  active: true;

  /** Derived from claims. */
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
}

export interface SenderVisible {
  sender_id: SenderId;
  name: string;
  active: true;
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
  | "bad_request"
  | "forbidden"
  | "conflict"
  | "not_in_phase"
  | "not_claimed";

export interface ErrorRes {
  code?: RoomCode;
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}
export type ErrorMsg = WsEnvelope<"ERROR", ErrorRes>;

/* ---------------------------------- */
/* Requests — Master                   */
/* ---------------------------------- */

export interface CreateRoomReq {
  senders: Array<{
    sender_id: SenderId;
    name: string;
    active: boolean;
    reels_count: number;
  }>;

  rounds: Array<{
    round_id: RoundId;
    items: Array<{
      item_id: ItemId;
      reel: {
        reel_id: ReelId;
        url: string;
      };
      true_sender_ids: SenderId[];
    }>;
  }>;

  round_order?: RoundId[];
}
export type CreateRoomMsg = WsEnvelope<"CREATE_ROOM", CreateRoomReq>;

export interface TogglePlayerReq {
  code: RoomCode;
  master_key: MasterKey;
  player_id: PlayerId;
  active: boolean;
}
export type TogglePlayerMsg = WsEnvelope<"TOGGLE_PLAYER", TogglePlayerReq>;

export interface StartGameReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type StartGameMsg = WsEnvelope<"START_GAME", StartGameReq>;

export interface ReelOpenedReq {
  code: RoomCode;
  master_key: MasterKey;
  round_id: RoundId;
  item_id: ItemId;
}
export type ReelOpenedMsg = WsEnvelope<"REEL_OPENED", ReelOpenedReq>;

export interface EndItemReq {
  code: RoomCode;
  master_key: MasterKey;
  round_id: RoundId;
  item_id: ItemId;
}
export type EndItemMsg = WsEnvelope<"END_ITEM", EndItemReq>;

export interface StartNextRoundReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type StartNextRoundMsg = WsEnvelope<"START_NEXT_ROUND", StartNextRoundReq>;

export interface RoomClosedReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type RoomClosedMsg = WsEnvelope<"ROOM_CLOSED", RoomClosedReq>;

/* ---------------------------------- */
/* Requests — Play                     */
/* ---------------------------------- */

export interface JoinRoomReq {
  code: RoomCode;
  device_id: DeviceId;
}
export type JoinRoomMsg = WsEnvelope<"JOIN_ROOM", JoinRoomReq>;

export interface TakePlayerReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
}
export type TakePlayerMsg = WsEnvelope<"TAKE_PLAYER", TakePlayerReq>;

export interface RenamePlayerReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
  new_name: string;
}
export type RenamePlayerMsg = WsEnvelope<"RENAME_PLAYER", RenamePlayerReq>;

export interface UpdateAvatarReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
  /** base64 or data URL */
  image: string;
}
export type UpdateAvatarMsg = WsEnvelope<"UPDATE_AVATAR", UpdateAvatarReq>;

export interface SubmitVoteReq {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  player_id: PlayerId;
  device_id: DeviceId;
  selections: SenderId[];
}
export type SubmitVoteMsg = WsEnvelope<"SUBMIT_VOTE", SubmitVoteReq>;

/* ---------------------------------- */
/* Requests — Resync                   */
/* ---------------------------------- */

export interface StateSyncReq {
  code: RoomCode;
  device_id: DeviceId;
  /** Optional; if valid, server includes master-only fields. */
  master_key?: MasterKey;
}
export type StateSyncMsg = WsEnvelope<"STATE_SYNC", StateSyncReq>;

/* ---------------------------------- */
/* Responses / Pushes                  */
/* ---------------------------------- */

export interface RoomCreatedRes {
  code: RoomCode;
  master_key: MasterKey;
  phase: Phase; // lobby
  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];
}
export type RoomCreatedMsg = WsEnvelope<"ROOM_CREATED", RoomCreatedRes>;

export interface JoinOkRes {
  code: RoomCode;
  phase: Phase;
  players_visible: PlayerVisible[];
}
export type JoinOkMsg = WsEnvelope<"JOIN_OK", JoinOkRes>;

export interface TakePlayerOkRes {
  code: RoomCode;
  player_id: PlayerId;
}
export type TakePlayerOkMsg = WsEnvelope<"TAKE_PLAYER_OK", TakePlayerOkRes>;

export interface TakePlayerFailRes {
  code: RoomCode;
  player_id: PlayerId;
  reason: "taken_now" | "disabled" | "inactive" | "device_already_has_player";
}
export type TakePlayerFailMsg = WsEnvelope<"TAKE_PLAYER_FAIL", TakePlayerFailRes>;

export interface PlayerUpdateRes {
  code: RoomCode;
  player: PlayerVisible;
  sender_updated?: SenderVisible;
}
export type PlayerUpdateMsg = WsEnvelope<"PLAYER_UPDATE", PlayerUpdateRes>;

export interface SlotInvalidatedRes {
  code: RoomCode;
  player_id: PlayerId;
  reason: "disabled_or_deleted";
}
export type SlotInvalidatedMsg = WsEnvelope<"SLOT_INVALIDATED", SlotInvalidatedRes>;

export interface GameStartRes {
  code: RoomCode;
}
export type GameStartMsg = WsEnvelope<"GAME_START", GameStartRes>;

export interface NewItemRes {
  code: RoomCode;
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
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  k: number;
  senders_selectable: SenderSelectable[];
}
export type StartVoteMsg = WsEnvelope<"START_VOTE", StartVoteRes>;

export interface VoteAckRes {
  code: RoomCode;
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
  code: RoomCode;
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
  code: RoomCode;
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
  code: RoomCode;
  round_id: RoundId;
  players: RoundRecapPerPlayer[];
}
export type RoundRecapMsg = WsEnvelope<"ROUND_RECAP", RoundRecapRes>;

export interface RoundFinishedRes {
  code: RoomCode;
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

  /** Master-only (if master_key valid) and only meaningful when status=vote */
  votes_received_player_ids?: PlayerId[];

  /** Master-only (if master_key valid) and only meaningful when status=reveal_wait */
  current_vote_results?: Omit<VoteResultsRes, "code">;
}

export interface StateSyncRes {
  code: RoomCode;
  phase: Phase;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  /** Master-only (master_key valid) */
  players_all?: PlayerAll[];
  /** Master-only (master_key valid) */
  senders_all?: SenderAll[];

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
  code: RoomCode;
  ranking: RankingEntry[];
  scores: Record<PlayerId, number>;
}
export type GameOverMsg = WsEnvelope<"GAME_OVER", GameOverRes>;

export interface RoomClosedBroadcastRes {
  code: RoomCode;
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
  | CreateRoomMsg
  | TogglePlayerMsg
  | StartGameMsg
  | ReelOpenedMsg
  | EndItemMsg
  | StartNextRoundMsg
  | RoomClosedMsg
  | JoinRoomMsg
  | TakePlayerMsg
  | RenamePlayerMsg
  | UpdateAvatarMsg
  | SubmitVoteMsg
  | StateSyncMsg;

// Server -> Client
export type ServerToClientMsg =
  | RoomCreatedMsg
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
