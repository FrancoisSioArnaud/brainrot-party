import { WSClient, wsUrl } from "./wsClient";

export type SenderLite = { id_local: string; name: string; active: boolean; photo_url?: string | null };
export type GamePlayer = {
  id: string;
  name: string;
  active: boolean;
  photo_url: string | null;
  score: number;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
};

export type RoundItemLite = { id: string; k: number; resolved: boolean; opened: boolean; order_index: number };

export type GameStateSync = {
  room_code: string;
  phase: "IN_GAME" | "GAME_END";
  current_phase: string;
  current_round_index: number;
  current_item_index: number;
  timer_end_ts: number | null;

  senders: SenderLite[];
  players: GamePlayer[];

  round: { index: number; items: RoundItemLite[] } | null;
  focus_item: { id: string; k: number; opened: boolean; resolved: boolean } | null;

  remaining_senders: string[];
  votes_for_focus: Record<string, string[]>;
};

export class GameClient {
  ws = new WSClient();

  onState: ((st: GameStateSync) => void) | null = null;
  onEvent: ((type: string, payload: any) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  async connect(room_code: string, role: "master" | "play") {
    await this.ws.connect(wsUrl(`/ws/game/${room_code}?role=${role}`));

    this.ws.onMessage((msg) => {
      if (msg.type === "state_sync") {
        this.onState?.(msg.payload as GameStateSync);
        return;
      }
      if (msg.type === "error") {
        this.onError?.(msg.payload?.code || "UNKNOWN", msg.payload?.message || "Erreur");
        return;
      }
      // passthrough for gameplay events
      this.onEvent?.(msg.type, msg.payload);
    });
  }

  masterReady() {
    return this.ws.request({ type: "master_ready", payload: {} });
  }
  playReady(player_id: string) {
    return this.ws.request({ type: "play_ready", payload: { player_id } });
  }

  // Master controls
  openReel() {
    return this.ws.request({ type: "open_reel", payload: {} });
  }
  startVoting() {
    return this.ws.request({ type: "start_voting", payload: {} });
  }
  startTimer(duration = 10) {
    return this.ws.request({ type: "start_timer", payload: { duration } });
  }
  forceCloseVoting() {
    return this.ws.request({ type: "force_close_voting", payload: {} });
  }

  // Play
  castVote(player_id: string, sender_ids: string[]) {
    return this.ws.request({ type: "cast_vote", payload: { player_id, sender_ids } });
  }
}
