import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { PROTOCOL_VERSION } from "@brp/contracts";

type Handlers = {
  onMessage: (msg: ServerToClientMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: Event) => void;
};

function backendWsUrl(): string {
  const env = (import.meta as any).env?.VITE_BACKEND_WS as string | undefined;
  if (env) return env;

  // Production default: same-origin WS (/ws proxied by nginx)
  const { protocol, host } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${host}/ws`;
}

export class BrpWsClient {
  private ws: WebSocket | null = null;

  connectJoinRoom(
    params: { room_code: string; device_id: string; master_key?: string },
    handlers: Handlers
  ) {
    this.close();

    const ws = new WebSocket(backendWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      const join: ClientToServerMsg = {
        type: "JOIN_ROOM",
        payload: {
          room_code: params.room_code,
          device_id: params.device_id,
          protocol_version: PROTOCOL_VERSION,
          master_key: params.master_key,
        },
      };
      ws.send(JSON.stringify(join));
      handlers.onOpen?.();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerToClientMsg;
        handlers.onMessage(msg);
      } catch {
        // ignore
      }
    };

    ws.onerror = (e) => handlers.onError?.(e);
    ws.onclose = () => handlers.onClose?.();
  }

  send(msg: ClientToServerMsg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
