import { WSClient, wsUrl } from "./wsClient";

export class GameClient {
  ws = new WSClient();

  async connectMaster(roomCode: string) {
    await this.ws.connect(wsUrl(`/ws/game/${roomCode}?role=master`));
  }

  async connectPlay(roomCode: string) {
    await this.ws.connect(wsUrl(`/ws/game/${roomCode}?role=play`));
  }

  masterHello(room_code: string, master_key: string) {
    this.ws.send({ type: "master_hello", payload: { room_code, master_key } });
  }

  playHello(room_code: string, device_id: string, player_id: string, token: string) {
    this.ws.send({ type: "play_hello", payload: { room_code, device_id, player_id, player_session_token: token } });
  }

  masterOpenReel(master_key: string, item_id: string) {
    this.ws.send({ type: "master_open_reel", payload: { master_key, item_id } });
  }

  masterStartTimer(master_key: string, item_id: string, duration_seconds: number) {
    this.ws.send({ type: "master_start_timer", payload: { master_key, item_id, duration_seconds } });
  }

  castVote(player_id: string, token: string, item_id: string, sender_ids: string[]) {
    this.ws.send({ type: "cast_vote", payload: { player_id, player_session_token: token, item_id, sender_ids } });
  }
}
