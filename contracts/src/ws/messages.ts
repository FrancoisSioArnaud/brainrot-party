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

/** Master ends current item (game). */
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
  { room_code: RoomCode; phase: Phase; protocol_version: typeof PROTOCOL_VERSION }
>;

export type StateSyncResponseMsg = WsEnvelope<"STATE_SYNC_RESPONSE", StateSyncRes>;

export type TakePlayerOkMsg = WsEnvelope<"TAKE_PLAYER_OK", { room_code: RoomCode; my_player_id: PlayerId }>;

export type TakePlayerFailMsg = WsEnvelope<
  "TAKE_PLAYER_FAIL",
  {
    room_code: RoomCode;
    player_id: PlayerId;
    reason: "setup_not_ready" | "device_already_has_player" | "taken_now" | "inactive";
  }
>;

export type SlotInvalidatedMsg = WsEnvelope<
  "SLOT_INVALIDATED",
  {
    room_code: RoomCode;
    player_id: PlayerId;
    reason: "reset_by_master" | "disabled_or_deleted";
  }
>;

export type LobbyPlayersMsg = WsEnvelope<
  "LOBBY_PLAYERS",
  {
    room_code: RoomCode;
    players: PlayerVisible[];
  }
>;

export type LobbySendersMsg = WsEnvelope<
  "LOBBY_SENDERS",
  {
    room_code: RoomCode;
    senders: SenderVisible[];
  }
>;

export type GameStartMsg = WsEnvelope<"GAME_START", { room_code: RoomCode }>;

export type NewItemMsg = WsEnvelope<
  "NEW_ITEM",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_index: number;
    item_id: ItemId;

    // existing structure
    reel: ReelPublic;

    // Option B: explicit alias for frontend convenience
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
    slots_total: number;
  }
>;

export type VoteAckMsg = WsEnvelope<
  "VOTE_ACK",
  {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
  }
>;

export type PlayerVotedMsg = WsEnvelope<
  "PLAYER_VOTED",
  {
    room_code: RoomCode;
    player_id: PlayerId;
  }
>;

export type VoteResultsMsg = WsEnvelope<"VOTE_RESULTS", { room_code: RoomCode; results: VoteResultsPublic }>;

export type RoundRecapMsg = WsEnvelope<
  "ROUND_RECAP",
  {
    room_code: RoomCode;
    round_id: RoundId;
  }
>;

export type RoundFinishedMsg = WsEnvelope<
  "ROUND_FINISHED",
  {
    room_code: RoomCode;
    round_id: RoundId;
  }
>;

export type GameOverMsg = WsEnvelope<
  "GAME_OVER",
  {
    room_code: RoomCode;
  }
>;

export type ErrorResMsg = WsEnvelope<"ERROR", ErrorMsg>;

export type ServerToClientMsg =
  | JoinOkMsg
  | StateSyncResponseMsg
  | TakePlayerOkMsg
  | TakePlayerFailMsg
  | SlotInvalidatedMsg
  | LobbyPlayersMsg
  | LobbySendersMsg
  | GameStartMsg
  | NewItemMsg
  | StartVoteMsg
  | VoteAckMsg
  | PlayerVotedMsg
  | VoteResultsMsg
  | RoundRecapMsg
  | RoundFinishedMsg
  | GameOverMsg
  | ErrorResMsg;
