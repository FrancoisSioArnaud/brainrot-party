import { WSClient, wsUrl } from "./wsClient";

type Msg = { type: string; ts?: number; req_id?: string; payload?: any };

export type LobbyState = {
  join_code: string;
  players: Array<{
    id: string;
    type: "sender_linked" | "manual";
    sender_id_local: string | null;
    active: boolean;
    name: string;
    status: "free" | "connected" | "afk" | "disabled";
    photo_url: string | null;
    afk_expires_at_ms: number | null;
    afk_seconds_left: number | null;
  }>;
  senders: Array<{ id_local: string; name: string; active: boolean }>;
};

export class LobbyClient {
  ws = new WSClient();

  onState: ((s: LobbyState) => void) | null = null;
  onEvent: ((type: string, payload: any) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  async connectPlay(joinCode: string) {
    await this.ws.connect(wsUrl(`/ws/lobby/${joinCode}?role=play`));

    this.ws.onMessage((m: Msg) => {
      if (m.type === "lobby_state" && m.payload) {
        this.onState?.(m.payload as LobbyState);
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
  }

  async playHello(device_id: string) {
    await this.ws.request({ type: "play_hello", payload: { device_id } });
  }

  /**
   * ✅ Atomic claim. On success, returns { player_id, player_session_token }.
   * Store these in localStorage:
   * - brp_player_id
   * - brp_player_session_token
   */
  async claimPlayer(joinCode: string, device_id: string, player_id: string) {
    const res = await this.ws.request({
      type: "claim_player",
      payload: { device_id, player_id }
    });
    // ack payload from backend: { ok: true, player_id, player_session_token }
    const pid = String(res?.player_id || "");
    const tok = String(res?.player_session_token || "");
    if (!pid || !tok) throw new Error("CLAIM_BAD_ACK");

    // persist
    localStorage.setItem("brp_join_code", joinCode);
    localStorage.setItem("brp_player_id", pid);
    localStorage.setItem("brp_player_session_token", tok);

    return { player_id: pid, player_session_token: tok };
  }

  async releasePlayer(device_id: string, player_id: string, player_session_token: string) {
    await this.ws.request({
      type: "release_player",
      payload: { device_id, player_id, player_session_token }
    });
    // clear local
    localStorage.removeItem("brp_player_id");
    localStorage.removeItem("brp_player_session_token");
  }

  async ping(device_id: string, player_id: string, player_session_token: string) {
    await this.ws.request({
      type: "ping",
      payload: { device_id, player_id, player_session_token }
    });
  }

  async setPlayerName(device_id: string, player_id: string, player_session_token: string, name: string) {
    await this.ws.request({
      type: "set_player_name",
      payload: { device_id, player_id, player_session_token, name }
    });
  }

  async resetPlayerName(device_id: string, player_id: string, player_session_token: string) {
    await this.ws.request({
      type: "reset_player_name",
      payload: { device_id, player_id, player_session_token }
    });
  }
}
