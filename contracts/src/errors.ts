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
  room_code?: string;
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

export type ErrorMsg = {
  type: "ERROR";
  payload: ErrorRes;
};
