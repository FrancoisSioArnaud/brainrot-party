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
  VoteResultsPublic,
  StateSyncRes,
} from "../domain.js";

// NOTE: keep these imports aligned with your existing repo layout.
// In your zip, these existed; if paths differ, adjust after paste.
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

/** Lobby: toggle player active (master) */
export type TogglePlayerMsg = WsEnvelope<"TOGGLE_PLAYER", { player_id: PlayerId; active: boolean }>;

export type ResetClaimsMsg = WsEnvelope<"RESET_CLAIMS", {}>;

/** Master adds a new manual player (lobby-only). */
export type AddPlayerMsg = WsEnvelope<"ADD_PLAYER", { name?: string }>;

/** Master deletes a manual player (lobby-only). */
export type DeletePlayerMsg = WsEnvelope<"DELETE_PLAYER", { player_id: PlayerId }>;

export type StartGameMsg = WsEnvelope<"START_GAME", {}>;

/**
 * Master opens a reel item.
 * - If item is pending: server enters voting and starts vote for Plays.
 * - If item is voted: server treats as no-op (master may still window.open locally).
 */
export type OpenItemMsg = WsEnvelope<"OPEN_ITEM", { round_id: RoundId; item_id: ItemId }>;

/** Master requests a forced close countdown (10s). */
export type ForceCloseVoteMsg = WsEnvelope<"FORCE_CLOSE_VOTE", { round_id: RoundId; item_id: ItemId }>;

export type StartNextRoundMsg = WsEnvelope<"START_NEXT_ROUND", {}>;

export type RoomClosedMsg = WsEnvelope<"ROOM_CLOSED", {}>;

/** Play claim */
export type TakePlayerMsg = WsEnvelope<"TAKE_PLAYER", { player_id: PlayerId }>;

/** Play release claim */
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
  | OpenItemMsg
  | ForceCloseVoteMsg
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

export type TakePlayerOkMsg = WsEnvelope<
  "TAKE_PLAYER_OK",
  { room_code: RoomCode; my_player_id: PlayerId }
>;

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

/** Vote opened for an item (sent to Plays). */
export type StartVoteMsg = WsEnvelope<
  "START_VOTE",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    /** K = max selectable senders for this vote */
    k: number;
  }
>;

/** Server announces a forced close countdown start (10s). */
export type VoteForceCloseStartedMsg = WsEnvelope<
  "VOTE_FORCE_CLOSE_STARTED",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    ends_at_ms: number;
  }
>;

export type VoteAckMsg = WsEnvelope<
  "VOTE_ACK",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    accepted: boolean;
    reason?: "invalid_selection" | "late" | "too_many" | "not_in_vote" | "not_claimed" | "not_expected_voter";
  }
>;

export type PlayerVotedMsg = WsEnvelope<
  "PLAYER_VOTED",
  { room_code: RoomCode; round_id: RoundId; item_id: ItemId; player_id: PlayerId }
>;

export type VoteResultsMsg = WsEnvelope<"VOTE_RESULTS", { room_code: RoomCode } & VoteResultsPublic>;

/** Item is now voted, and true senders are committed in server state (useful for reconnect/master grid). */
export type ItemVotedMsg = WsEnvelope<
  "ITEM_VOTED",
  { room_code: RoomCode; round_id: RoundId; item_id: ItemId; true_senders: SenderId[] }
>;

/** Round completed -> show score modal. If game_over=true, this is the final modal. */
export type RoundScoreModalMsg = WsEnvelope<
  "ROUND_SCORE_MODAL",
  {
    room_code: RoomCode;
    round_id: RoundId;
    game_over: boolean;
    ranking: Array<{ player_id: PlayerId; score_total: number; rank: number }>;
    scores: Record<PlayerId, number>;
  }
>;

export type StateSyncResponseMsg = WsEnvelope<"STATE_SYNC_RESPONSE", StateSyncRes>;

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
  | StartVoteMsg
  | VoteForceCloseStartedMsg
  | VoteAckMsg
  | PlayerVotedMsg
  | VoteResultsMsg
  | ItemVotedMsg
  | RoundScoreModalMsg
  | StateSyncResponseMsg
  | RoomClosedBroadcastMsg;

/* ---------- helpers ---------- */

export function isProtocolVersionSupported(v: number): boolean {
  return v === PROTOCOL_VERSION;
}
