import { WSClient, wsUrl } from "./wsClient";
import { toast } from "../components/common/Toast";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: "free" | "connected" | "afk" | "disabled";
  photo_url: string | null;
};

export type LobbyState = {
  join_code: string;
  players: LobbyPlayer[];
  senders: { id_local: string; name: string; active: boolean }[];
};

export class LobbyClient {
  ws = new WSClient();
  state: LobbyState | null = null;

  onState: ((st: LobbyState) => void) | null = null;
  onGameRoomCreated: ((room_code: string) => void) | null = null;
  onLobbyClosed: ((reason: string, room_code?: string) => void) | null = null;

  async connectMaster(join_code: string) {
    await this.ws.connect(wsUrl(`/ws/lobby/${join_code}?role=master`));
  }

  async connectPlay(join_code: string) {
    await this.ws.connect(wsUrl(`/ws/lobby/${join_code}?role=play`));
  }

  bind() {
    this.ws.onMessage((msg) => {
      if (msg.type === "lobby_state") {
        this.state = msg.payload;
        this.onState?.(msg.payload);
      }
      if (msg.type === "game_room_created") {
        const room_code = msg.payload?.room_code;
        if (room_code) this.onGameRoomCreated?.(room_code);
      }
      if (msg.type === "lobby_closed") {
        const reason = msg.payload?.reason || "unknown";
        const room_code = msg.payload?.room_code;
        this.onLobbyClosed?.(reason, room_code);
      }
    });
  }

  masterHello(master_key: string, local_room_id: string) {
    this.ws.send({ type: "master_hello", payload: { master_key, local_room_id, client_version: "web-1" } });
  }

  playHello(device_id: string) {
    this.ws.send({ type: "play_hello", payload: { device_id, client_version: "play-1" } });
  }

  syncFromDraft(master_key: string, draft: any) {
    this.ws.send({ type: "sync_from_draft", payload: { master_key, draft } });
  }

  async createManualPlayer(master_key: string, name: string) {
    this.ws.send({ type: "create_manual_player", payload: { master_key, name } });
  }

  deletePlayer(master_key: string, player_id: string) {
    this.ws.send({ type: "delete_player", payload: { master_key, player_id } });
  }

  setPlayerActive(master_key: string, player_id: string, active: boolean) {
    this.ws.send({ type: "set_player_active", payload: { master_key, player_id, active } });
  }

  async startGame(master_key: string, local_room_id: string) {
    this.ws.send({ type: "start_game_request", payload: { master_key, local_room_id } });
    toast("Start game…");
  }

  async claimPlayer(device_id: string, player_id: string) {
    this.ws.send({ type: "claim_player", payload: { device_id, player_id } });
    toast("Demande envoyée…");
  }

  releasePlayer(device_id: string, player_id: string, token: string) {
    this.ws.send({ type: "release_player", payload: { device_id, player_id, player_session_token: token } });
  }

  ping(device_id: string, player_id: string, token: string) {
    this.ws.send({ type: "ping", payload: { device_id, player_id, player_session_token: token } });
  }

  setPlayerName(device_id: string, player_id: string, token: string, name: string) {
    this.ws.send({ type: "set_player_name", payload: { device_id, player_id, player_session_token: token, name } });
  }
}
