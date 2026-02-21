// frontend/src/ws/lobbyClient.ts
import { WSClient, wsUrl } from "./wsClient";

type Msg = { type: string; ts?: number; req_id?: string; payload?: any };

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: "free" | "connected" | "afk" | "disabled";
  photo_url: string | null;
  afk_expires_at_ms?: number | null;
  afk_seconds_left?: number | null;
};

export type LobbyReelItem = {
  url: string;
  sender_local_ids: string[];
};

export type LobbyState = {
  join_code: string;
  players: LobbyPlayer[];
  senders: { id_local: string; name: string; active: boolean }[];
  reel_items?: LobbyReelItem[];
};

export type SyncDraftPayload = {
  local_room_id: string;
  senders_active: Array<{ id_local: string; name: string; active: boolean }>;
  players: Array<{
    id: string;
    type: "sender_linked" | "manual";
    sender_id?: string | null;
    sender_id_local?: string | null;
    active: boolean;
    name: string;
  }>;
  reel_items: LobbyReelItem[];
};

export class LobbyClient {
  ws = new WSClient();
  state: LobbyState | null = null;

  onState: ((st: LobbyState) => void) | null = null;
  onEvent: ((type: string, payload: any) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  private bound = false;

  constructor() {
    this.bind();
  }

  bind() {
    if (this.bound) return;
    this.bound = true;

    this.ws.onMessage((msg: Msg) => {
      if (msg.type === "lobby_state") {
        this.state = msg.payload as LobbyState;
        this.onState?.(this.state);
        return;
      }

      if (msg.type === "error") {
        // WSClient already toasts, but we also forward
        const code = String(msg.payload?.code || "ERROR");
        const message = String(msg.payload?.message || "Erreur");
        this.onError?.(code, message);
        this.onEvent?.("error", msg.payload);
        return;
      }

      // forward other events
      this.onEvent?.(msg.type, msg.payload);
    });
  }

  async connectMaster(join_code: string) {
    await this.ws.connect(wsUrl(`/ws/lobby/${join_code}?role=master`));
  }

  async connectPlay(join_code: string) {
    await this.ws.connect(wsUrl(`/ws/lobby/${join_code}?role=play`));
  }

  // ===== Master =====
  masterHello(master_key: string, local_room_id: string) {
    this.ws.send({
      type: "master_hello",
      payload: { master_key, local_room_id, client_version: "web-1" },
    });
  }

  syncFromDraft(master_key: string, draft: SyncDraftPayload) {
    this.ws.send({ type: "sync_from_draft", payload: { master_key, draft } });
  }

  createManualPlayer(master_key: string, name: string) {
    return this.ws.request({ type: "create_manual_player", payload: { master_key, name } });
  }

  deletePlayer(master_key: string, player_id: string) {
    return this.ws.request({ type: "delete_player", payload: { master_key, player_id } });
  }

  setPlayerActive(master_key: string, player_id: string, active: boolean) {
    return this.ws.request({ type: "set_player_active", payload: { master_key, player_id, active } });
  }

  startGame(master_key: string) {
    return this.ws.request({ type: "start_game_request", payload: { master_key } });
  }

  // ===== Play =====
  playHello(device_id: string) {
    return this.ws.request({
      type: "play_hello",
      payload: { device_id, client_version: "play-1" },
    });
  }

  async claimPlayer(joinCode: string, device_id: string, player_id: string) {
    try {
      const res = await this.ws.request({
        type: "claim_player",
        payload: { device_id, player_id },
      });

      const pid = String(res?.player_id || "");
      const tok = String(res?.player_session_token || "");
      if (!pid || !tok) throw new Error("CLAIM_BAD_ACK");

      // Play spec: lobbies are independent; we persist only the current room code
      localStorage.setItem("brp_current_room_code", joinCode);
      localStorage.setItem("brp_player_id", pid);
      localStorage.setItem("brp_player_session_token", tok);

      return { player_id: pid, player_session_token: tok };
    } catch (e: any) {
      // e is payload from WSClient.request reject (usually {code,message})
      const code = String(e?.code || "CLAIM_FAILED");
      const message = String(e?.message || "Impossible de claim");
      this.onError?.(code, message);
      throw e;
    }
  }

  releasePlayer(joinCode: string, device_id: string, player_id: string, player_session_token: string) {
    void joinCode; // joinCode kept for signature consistency (routing uses current WS url)
    return this.ws.request({
      type: "release_player",
      payload: { device_id, player_id, player_session_token },
    });
  }

  ping(joinCode: string, device_id: string, player_id: string, player_session_token: string) {
    void joinCode;
    return this.ws.request({
      type: "ping",
      payload: { device_id, player_id, player_session_token },
    });
  }

  setPlayerName(joinCode: string, device_id: string, player_id: string, player_session_token: string, name: string) {
    void joinCode;
    return this.ws.request({
      type: "set_player_name",
      payload: { device_id, player_id, player_session_token, name },
    });
  }

  resetPlayerName(joinCode: string, device_id: string, player_id: string, player_session_token: string) {
    void joinCode;
    return this.ws.request({
      type: "reset_player_name",
      payload: { device_id, player_id, player_session_token },
    });
  }
}
