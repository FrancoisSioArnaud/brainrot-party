import type WebSocket from "ws";

export type ConnCtx = {
  ws: WebSocket;
  room_code: string | null;
  device_id: string | null;
  is_master: boolean;
  my_player_id: string | null;
};
