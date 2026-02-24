export type RoomPhase = "lobby" | "game" | "game_over";

export interface Player {
  id: string; // UUID
  name: string;
  active: boolean;
  claimed_by?: string; // device_id
  score: number;
}

export interface Sender {
  id: string;
  name: string;
  active: boolean;
}

export interface ReelItem {
  id: string;
  url: string;
  sender_id: string;
}

export interface RoundState {
  round_id: number;
  item_id: string | null;
  reel_opened: boolean;
  votes: Record<string, string>; // player_id -> voted_player_id
}

export interface GameState {
  current_round: number;
  total_rounds: number;
  round: RoundState | null;
}

export interface LobbyState {
  players: Player[];
  senders: Sender[];
}

export interface RoomState {
  room_code: string;
  phase: RoomPhase;
  lobby: LobbyState;
  game: GameState | null;
}
