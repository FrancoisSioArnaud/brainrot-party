import { WSClient, wsUrl } from "./wsClient";

export type GameStateSync = {
  room_code: string;
  phase: string;
  current_phase: string;
  current_round_index: number;
  current_item_index: number;
  timer_end_ts: number | null;

  senders: Array<{
    id_local: string;
    name: string;
    active: boolean;
    photo_url: string | null;
    color_token: string;
  }>;

  players: Array<{
    id: string;
    name: string;
    active: boolean;
    photo_url: string | null;
    score: number;
  }>;

  round: null | {
    index: number;
    items: Array<{ id: string; k: number; opened: boolean; resolved: boolean; reel_url?: string }>;
  };

  focus_item: null | { id: string; k: number; opened: boolean; resolved: boolean; reel_url?: string };

  remaining_senders: string[];
  votes_for_focus: Record<string, string[]>;
};

type Msg = { type: string; ts?: number; req_id?: string; payload?: any };

export class GameClient {
  ws = new WSClient();

  onState: ((s: GameStateSync) => void) | null = null;
  onEvent: ((type: string, payload: any) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  private role: "master" | "play" = "play";
  private roomCode: string = "";

  // ✅ always cached to allow castVote without racing the first state_sync
  private lastState: GameStateSync | null = null;

  async connect(roomCode: string, role: "master" | "play") {
    this.role = role;
    this.roomCode = roomCode;

    await this.ws.connect(wsUrl(`/ws/game/${roomCode}?role=${role}`));

    this.ws.onMessage((m: Msg) => {
      if (m.type === "state_sync" && m.payload) {
        const s = m.payload as GameStateSync;
        this.lastState = s;
        this.onState?.(s);
        return;
      }
      if (m.type === "error") {
        const code = String(m.payload?.code || "ERROR");
        const message = String(m.payload?.message || "Erreur");
        this.onError?.(code, message);
        return;
      }
      this.onEvent?.(m.type, m.payload);
    });

    // hello (server usually replies with immediate state_sync)
    if (role === "master") {
      await this.ws.request({ type: "master_hello", payload: {} });
    } else {
      await this.ws.request({ type: "play_hello", payload: {} });
    }
  }

  // Backward compat: keep method (no-op now since cache is integrated)
  attachStateCache() {
    // already handled in connect()
  }

  async masterReady() {
    if (this.role !== "master") return;
    await this.ws.request({ type: "master_ready", payload: {} });
  }

  async playReady(player_id: string) {
    if (this.role !== "play") return;
    await this.ws.request({ type: "play_ready", payload: { player_id } });
  }

  async openReel() {
    if (this.role !== "master") return;
    await this.ws.request({ type: "open_reel", payload: {} });
  }

  async startVoting() {
    if (this.role !== "master") return;
    await this.ws.request({ type: "start_voting", payload: {} });
  }

  async startTimer(durationSeconds: number) {
    if (this.role !== "master") return;
    await this.ws.request({ type: "start_timer", payload: { duration: durationSeconds } });
  }

  async forceCloseVoting() {
    if (this.role !== "master") return;
    await this.ws.request({ type: "force_close_voting", payload: {} });
  }

  /**
   * ✅ Vote: le Play vote toujours sur le focus item.
   * - item_id est lu depuis le dernier state_sync (cache).
   */
  async castVote(player_id: string, sender_ids: string[]) {
    if (this.role !== "play") return;

    const item_id = this.lastState?.focus_item?.id;
    if (!item_id) throw new Error("NO_FOCUS_ITEM");

    await this.ws.request({
      type: "cast_vote",
      payload: { player_id, item_id, sender_ids },
    });
  }
}
