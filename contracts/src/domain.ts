export type RoomCode = string;
export type PlayerId = string;
export type SenderId = string;
export type RoundId = string;
export type ItemId = string;

export type Phase = "lobby" | "game" | "game_over";

export type GameStatus =
  | "reveal"
  | "vote"
  | "reveal_wait"
  | "round_recap";

export type RoundItem = {
  item_id: ItemId;
  reel_url: string;
  true_sender_ids: SenderId[];
  k: number;
};

export type Round = {
  round_id: RoundId;
  items: RoundItem[];
};

export type GameStateSync = {
  current_round_index: number;
  current_item_index: number;
  status: GameStatus;
  expected_player_ids: PlayerId[];
  votes: Record<PlayerId, SenderId[]>;
  round_finished: boolean;
};

export type PlayerVisible = {
  player_id: PlayerId;
  sender_id: SenderId | null;
  is_sender_bound: boolean;
  active: boolean;
  status: "free" | "taken";
  name: string;
  avatar_url: string | null;
};

export type SenderVisible = {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
};

export type StateSyncRes = {
  room_code: RoomCode;
  phase: Phase;
  setup_ready: boolean;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  players_all?: any[];
  senders_all?: any[];

  my_player_id: PlayerId | null;

  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
};
