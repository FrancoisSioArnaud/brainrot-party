// contracts/src/ws/messages.ts
import type {
  ItemId,
  PlayerId,
  RoundId,
  SenderId,
  RoomCode,
  DeviceId,
  MasterKey,
  Phase,
  PlayerVisible,
  SenderVisible,
  ReelPublic,
  SenderSelectable,
  VoteResultsPublic,
  StateSyncRes,
} from "../domain.js";
import type { ErrorMsg } from "../errors.js";
import { PROTOCOL_VERSION } from "../version.js";

export interface WsEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

/* ---------- Client -> Server ---------- */

export interface JoinRoomReq {
  room_code: RoomCode;
  device_id: DeviceId;
  protocol_version: number; // must equal PROTOCOL_VERSION
  master_key?: MasterKey;
}
export type JoinRoomMsg = WsEnvelope<"JOIN_ROOM", JoinRoomReq>;

export type RequestSyncMsg = WsEnvelope<"REQUEST_SYNC", {}>;

export type TogglePlayerMsg = WsEnvelope<"TOGGLE_PLAYER", { player_id: PlayerId; active: boolean }>;

export type ResetClaimsMsg = WsEnvelope<"RESET_CLAIMS", {}>;

/** Master adds a new manual player (lobby-only). */
export type AddPlayerMsg = WsEnvelope<"ADD_PLAYER", { name?: string }>;

/** Master deletes a manual player (lobby-only). */
export type DeletePlayerMsg = WsEnvelope<"DELETE_PLAYER", { player_id: PlayerId }>;

export type StartGameMsg = WsEnvelope<"START_GAME", {}>;

export type ReelOpenedMsg = WsEnvelope<"REEL_OPENED", { round_id: RoundId; item_id: ItemId }>;

export type EndItemMsg = WsEnvelope<"END_ITEM", { round_id: RoundId; item_id: ItemId }>;

export type StartNextRoundMsg = WsEnvelope<"START_NEXT_ROUND", {}>;

export type RoomClosedMsg = WsEnvelope<"ROOM_CLOSED", {}>;

export type TakePlayerMsg = WsEnvelope<"TAKE_PLAYER", { player_id: PlayerId }>;

/** Player releases their currently claimed slot and returns to the list. */
export type ReleasePlayerMsg = WsEnvelope<"RELEASE_PLAYER", {}>;

export type RenamePlayerMsg = WsEnvelope<"RENAME_PLAYER", { new_name: string }>;

export type UpdateAvatarMsg = WsEnvelope<"UPDATE_AVATAR", { image: string }>;

export type SubmitVoteMsg = WsEnvelope<
  "SUBMIT_VOTE",
  { round_id: RoundId; item_id: ItemId; selections: SenderId[] }
>;

export type ClientToServerMsg =
  | JoinRoomMsg
  | RequestSyncMsg
  | TogglePlayerMsg
  | ResetClaimsMsg
  | AddPlayerMsg
  | DeletePlayerMsg
  | StartGameMsg
  | ReelOpenedMsg
  | EndItemMsg
  | StartNextRoundMsg
  | RoomClosedMsg
  | TakePlayerMsg
  | ReleasePlayerMsg
  | RenamePlayerMsg
  | UpdateAvatarMsg
  | SubmitVoteMsg;

/* ---------- Server -> Client ---------- */

export type JoinOkMsg = WsEnvelope<
  "JOIN_OK",
  { room_code: RoomCode; phase: Phase; protocol_version: number }
>;

export type TakePlayerOkMsg = WsEnvelope<"TAKE_PLAYER_OK", { room_code: RoomCode; my_player_id: PlayerId }>;

export type TakePlayerFailMsg = WsEnvelope<
  "TAKE_PLAYER_FAIL",
  {
    room_code: RoomCode;
    player_id: PlayerId;
    reason:
      | "taken_now"
      | "inactive"
      | "device_already_has_player"
      | "player_not_found"
      | "setup_not_ready";
  }
>;

export type PlayerUpdateMsg = WsEnvelope<
  "PLAYER_UPDATE",
  { room_code: RoomCode; player: PlayerVisible; sender_updated?: SenderVisible }
>;

export type SlotInvalidatedMsg = WsEnvelope<
  "SLOT_INVALIDATED",
  { room_code: RoomCode; player_id: PlayerId; reason: "disabled_or_deleted" | "reset_by_master" }
>;

export type GameStartMsg = WsEnvelope<"GAME_START", { room_code: RoomCode }>;

/**
 * NEW_ITEM now includes `reel_url` for frontend convenience (alias of `reel.url`).
 */
export type NewItemMsg = WsEnvelope<
  "NEW_ITEM",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_index: number;
    item_id: ItemId;

    reel: ReelPublic;
    reel_url: string;

    k: number;
    senders_selectable: SenderSelectable[];
    slots_total: number;
  }
>;

export type StartVoteMsg = WsEnvelope<
  "START_VOTE",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    k: number;
    senders_selectable: SenderSelectable[];
  }
>;

export type VoteAckMsg = WsEnvelope<
  "VOTE_ACK",
  {
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
>;

export type PlayerVotedMsg = WsEnvelope<
  "PLAYER_VOTED",
  { room_code: RoomCode; round_id: RoundId; item_id: ItemId; player_id: PlayerId }
>;

export type VoteResultsMsg = WsEnvelope<"VOTE_RESULTS", { room_code: RoomCode } & VoteResultsPublic>;

export type RoundRecapMsg = WsEnvelope<
  "ROUND_RECAP",
  {
    room_code: RoomCode;
    round_id: RoundId;
    players: Array<{ player_id: PlayerId; points_round: number; score_total: number }>;
  }
>;

export type RoundFinishedMsg = WsEnvelope<"ROUND_FINISHED", { room_code: RoomCode; round_id: RoundId }>;

export type StateSyncResponseMsg = WsEnvelope<"STATE_SYNC_RESPONSE", StateSyncRes>;

export type GameOverMsg = WsEnvelope<
  "GAME_OVER",
  {
    room_code: RoomCode;
    ranking: Array<{ player_id: PlayerId; score_total: number; rank: number }>;
    scores: Record<PlayerId, number>;
  }
>;

export type RoomClosedBroadcastMsg = WsEnvelope<
  "ROOM_CLOSED_BROADCAST",
  { room_code: RoomCode; reason: "closed_by_master" }
>;

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

/* ---------- helpers ---------- */
