import { WSClient, wsUrl } from "./wsClient";

export type GamePlayer = {
  id: string;
  name: string;
  active: boolean;
  photo_url: string | null;
  score: number;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
};

export type GameStateSync = {
  room_code: string;
  phase: "IN_GAME" | "GAME_END";
  timer_end_ts: number | null;
  senders: Array<{ id_local: string; name: string; active: boolean }>;
  players: GamePlayer[];
};

export class GameClient {
  ws = new WSClient();
  onState: ((st: GameStateSync) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  async connect(room_code: string, role: "master" | "play") {
    await this.ws.connect(wsUrl(`/ws/game/${room_code}?role=${role}`));

    this.ws.onMessage((msg) => {
      if (msg.type === "state_sync") {
        this.onState?.(msg.payload as GameStateSync);
        return;
      }
      if (msg.type === "error") {
        const code = msg.payload?.code || "UNKNOWN";
        const message = msg.payload?.message || "Erreur";
        this.onError?.(code, message);
        return;
      }
    });
  }

  masterReady() {
    return this.ws.request({ type: "master_ready", payload: {} });
  }

  playReady(player_id: string) {
    return this.ws.request({ type: "play_ready", payload: { player_id } });
  }
}
