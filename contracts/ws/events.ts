import { RoomState } from "../domain";
import { WsError } from "../errors";

export type ServerToClientMessage =
  | StateSyncEvent
  | VoteRegisteredEvent
  | VoteResultsEvent
  | RoundRecapEvent
  | GameOverEvent
  | WsError;

export interface StateSyncEvent {
  type: "STATE_SYNC";
  payload: {
    state: RoomState;
  };
}

export interface VoteRegisteredEvent {
  type: "VOTE_REGISTERED";
  payload: {
    player_id: string;
  };
}

export interface VoteResultsEvent {
  type: "VOTE_RESULTS";
  payload: {
    round_id: number;
    item_id: string;
    results: Record<string, string>; // player_id -> voted_player_id
    scores: Record<string, number>; // player_id -> delta score
  };
}

export interface RoundRecapEvent {
  type: "ROUND_RECAP";
  payload: {
    standings: {
      player_id: string;
      score: number;
    }[];
  };
}

export interface GameOverEvent {
  type: "GAME_OVER";
  payload: {
    final_standings: {
      player_id: string;
      score: number;
    }[];
  };
}
