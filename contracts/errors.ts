export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "INVALID_MASTER_KEY"
  | "INVALID_PROTOCOL_VERSION"
  | "ROOM_ALREADY_STARTED"
  | "ROOM_NOT_IN_LOBBY"
  | "PLAYER_ALREADY_TAKEN"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_INACTIVE"
  | "NOT_MASTER"
  | "INVALID_STATE"
  | "INVALID_ROUND"
  | "INVALID_ITEM"
  | "VOTE_CLOSED"
  | "ALREADY_VOTED"
  | "INVALID_PAYLOAD"
  | "INTERNAL_ERROR";

export interface WsError {
  type: "ERROR";
  payload: {
    code: ErrorCode;
    message: string;
  };
}
