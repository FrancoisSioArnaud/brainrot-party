import { PROTOCOL_VERSION } from "../version";

export type ClientToServerMessage =
  | JoinRoomMessage
  | TakePlayerMessage
  | ReleasePlayerMessage
  | RenamePlayerMessage
  | TogglePlayerMessage
  | StartGameMessage
  | OpenReelMessage
  | SubmitVoteMessage
  | EndItemMessage;

export interface JoinRoomMessage {
  type: "JOIN_ROOM";
  payload: {
    protocol_version: number; // must match PROTOCOL_VERSION
    room_code: string;
    client_type: "master" | "play";
    master_key?: string; // required if master
    device_id: string;
  };
}

export interface TakePlayerMessage {
  type: "TAKE_PLAYER";
  payload: {
    player_id: string;
  };
}

export interface ReleasePlayerMessage {
  type: "RELEASE_PLAYER";
  payload: {
    player_id: string;
  };
}

export interface RenamePlayerMessage {
  type: "RENAME_PLAYER";
  payload: {
    player_id: string;
    name: string;
  };
}

export interface TogglePlayerMessage {
  type: "TOGGLE_PLAYER";
  payload: {
    player_id: string;
    active: boolean;
  };
}

export interface StartGameMessage {
  type: "START_GAME";
  payload: {};
}

export interface OpenReelMessage {
  type: "OPEN_REEL";
  payload: {};
}

export interface SubmitVoteMessage {
  type: "SUBMIT_VOTE";
  payload: {
    round_id: number;
    item_id: string;
    voted_player_id: string;
  };
}

export interface EndItemMessage {
  type: "END_ITEM";
  payload: {
    round_id: number;
    item_id: string;
  };
}
