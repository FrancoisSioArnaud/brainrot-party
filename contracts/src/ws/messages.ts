import type {
  RoomCode,
  PlayerId,
  SenderId,
  RoundId,
  ItemId,
  StateSyncRes,
} from "../domain";

export type JoinRoomReq = {
  type: "JOIN_ROOM";
  payload: {
    room_code: RoomCode;
    device_id: string;
    protocol_version: number;
    master_key?: string;
  };
};

export type JoinOkRes = {
  type: "JOIN_OK";
  payload: {
    room_code: RoomCode;
    phase: string;
    protocol_version: number;
  };
};

export type StateSyncResponse = {
  type: "STATE_SYNC_RESPONSE";
  payload: StateSyncRes;
};

export type RequestSyncReq = {
  type: "REQUEST_SYNC";
  payload: {};
};

/* -------- Lobby -------- */

export type ResetClaimsReq = {
  type: "RESET_CLAIMS";
  payload: {};
};

export type AddPlayerReq = {
  type: "ADD_PLAYER";
  payload: { name: string };
};

export type DeletePlayerReq = {
  type: "DELETE_PLAYER";
  payload: { player_id: PlayerId };
};

export type TogglePlayerReq = {
  type: "TOGGLE_PLAYER";
  payload: { player_id: PlayerId; active: boolean };
};

export type TakePlayerReq = {
  type: "TAKE_PLAYER";
  payload: { player_id: PlayerId };
};

export type TakePlayerOkEvt = {
  type: "TAKE_PLAYER_OK";
  payload: { room_code: RoomCode; my_player_id: PlayerId };
};

export type TakePlayerFailEvt = {
  type: "TAKE_PLAYER_FAIL";
  payload: {
    room_code: RoomCode;
    player_id: PlayerId;
    reason:
      | "setup_not_ready"
      | "device_already_has_player"
      | "inactive"
      | "player_not_found"
      | "taken_now";
  };
};

export type ReleasePlayerReq = {
  type: "RELEASE_PLAYER";
  payload: {};
};

export type SlotInvalidatedEvt = {
  type: "SLOT_INVALIDATED";
  payload: {
    room_code: RoomCode;
    player_id: PlayerId;
    reason: "reset_by_master" | "disabled_or_deleted";
  };
};

export type RenamePlayerReq = {
  type: "RENAME_PLAYER";
  payload: { new_name: string };
};

export type UpdateAvatarReq = {
  type: "UPDATE_AVATAR";
  payload: { image: string };
};

/* -------- Game -------- */

export type StartGameReq = {
  type: "START_GAME";
  payload: {};
};

export type GameStartEvt = {
  type: "GAME_START";
  payload: { room_code: RoomCode };
};

export type NewItemEvt = {
  type: "NEW_ITEM";
  payload: {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    reel_url: string;
  };
};

export type ReelOpenedReq = {
  type: "REEL_OPENED";
  payload: { round_id: RoundId; item_id: ItemId };
};

export type StartVoteEvt = {
  type: "START_VOTE";
  payload: {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    senders_selectable: SenderId[];
    k: number;
  };
};

export type SubmitVoteReq = {
  type: "SUBMIT_VOTE";
  payload: { round_id: RoundId; item_id: ItemId; selections: SenderId[] };
};

export type VoteAckEvt = {
  type: "VOTE_ACK";
  payload: { room_code: RoomCode; round_id: RoundId; item_id: ItemId };
};

export type PlayerVotedEvt = {
  type: "PLAYER_VOTED";
  payload: { room_code: RoomCode; player_id: PlayerId };
};

export type VoteResultsEvt = {
  type: "VOTE_RESULTS";
  payload: {
    room_code: RoomCode;
    round_id: RoundId;
    item_id: ItemId;
    votes: Record<PlayerId, SenderId[]>;
    true_sender_ids: SenderId[];
    scores: Record<PlayerId, number>;
  };
};

export type EndItemReq = {
  type: "END_ITEM";
  payload: {};
};

export type RoundRecapEvt = {
  type: "ROUND_RECAP";
  payload: {
    room_code: RoomCode;
    round_id: RoundId;
    scores: Record<PlayerId, number>;
  };
};

export type StartNextRoundReq = {
  type: "START_NEXT_ROUND";
  payload: {};
};

export type RoundFinishedEvt = {
  type: "ROUND_FINISHED";
  payload: { room_code: RoomCode; round_id: RoundId };
};

export type GameOverEvt = {
  type: "GAME_OVER";
  payload: { room_code: RoomCode; scores: Record<PlayerId, number> };
};

/* -------- Errors -------- */

export type ErrorRes = {
  type: "ERROR";
  payload: {
    room_code?: RoomCode;
    error: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export type ClientToServerMsg =
  | JoinRoomReq
  | RequestSyncReq
  | ResetClaimsReq
  | AddPlayerReq
  | DeletePlayerReq
  | TogglePlayerReq
  | TakePlayerReq
  | ReleasePlayerReq
  | RenamePlayerReq
  | UpdateAvatarReq
  | StartGameReq
  | ReelOpenedReq
  | SubmitVoteReq
  | EndItemReq
  | StartNextRoundReq;

export type ServerToClientMsg =
  | JoinOkRes
  | StateSyncResponse
  | TakePlayerOkEvt
  | TakePlayerFailEvt
  | SlotInvalidatedEvt
  | GameStartEvt
  | NewItemEvt
  | StartVoteEvt
  | VoteAckEvt
  | PlayerVotedEvt
  | VoteResultsEvt
  | RoundRecapEvt
  | RoundFinishedEvt
  | GameOverEvt
  | ErrorRes;
