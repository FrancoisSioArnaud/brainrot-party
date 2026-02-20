type Handler = (payload: any) => void;

function wsUrl(path: string) {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

function rid() {
  return `r_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export class PlayLobbyClient {
  ws: WebSocket | null = null;

  onLobbyState: Handler | null = null;
  onKicked: Handler | null = null;
  onClosed: Handler | null = null;
  onError: Handler | null = null;

  connect(join_code: string) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl(`/ws/lobby/${join_code}?role=play`));
      this.ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws_error"));

      ws.onmessage = (ev) => {
        let msg: any = null;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg) return;

        if (msg.type === "lobby_state") this.onLobbyState?.(msg.payload);
        else if (msg.type === "player_kicked") this.onKicked?.(msg.payload);
        else if (msg.type === "lobby_closed") this.onClosed?.(msg.payload);
        else if (msg.type === "error") this.onError?.(msg.payload);
      };

      ws.onclose = () => {};
    });
  }

  disconnect() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  send(type: string, payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, req_id: rid(), payload }));
  }

  hello(device_id: string) {
    this.send("play_hello", { device_id });
  }

  claimPlayer(device_id: string, player_id: string) {
    this.send("claim_player", { device_id, player_id });
  }

  releasePlayer(device_id: string, player_id: string, player_session_token: string) {
    this.send("release_player", { device_id, player_id, player_session_token });
  }

  ping(device_id: string, player_id: string, player_session_token: string) {
    this.send("ping", { device_id, player_id, player_session_token });
  }

  setName(device_id: string, player_id: string, player_session_token: string, name: string) {
    this.send("set_player_name", { device_id, player_id, player_session_token, name });
  }

  // ✅ NEW
  resetName(device_id: string, player_id: string, player_session_token: string) {
    this.send("reset_player_name", { device_id, player_id, player_session_token });
  }
}
