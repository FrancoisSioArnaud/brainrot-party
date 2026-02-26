import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";
import { PROTOCOL_VERSION } from "@brp/contracts";

type ConnectJoinArgs = {
  room_code: string;
  device_id: string;
  master_key?: string;
};

type Handlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onMessage?: (m: ServerToClientMsg) => void;
};

export class BrpWsClient {
  private ws: WebSocket | null = null;

  connectJoinRoom(args: ConnectJoinArgs, handlers: Handlers) {
    const url = this.buildWsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      handlers.onOpen?.();
      const join: ClientToServerMsg = {
        type: "JOIN_ROOM",
        payload: {
          room_code: args.room_code,
          device_id: args.device_id,
          protocol_version: PROTOCOL_VERSION,
          ...(args.master_key ? { master_key: args.master_key } : {}),
        },
      };
      ws.send(JSON.stringify(join));
    };

    ws.onclose = () => {
      handlers.onClose?.();
    };

    ws.onerror = () => {
      handlers.onError?.();
    };

    ws.onmessage = (evt) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      // contracts runtime guard (if present) not assumed here; keep typed dispatch
      handlers.onMessage?.(parsed as ServerToClientMsg);
    };
  }

  send(msg: ClientToServerMsg | any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    } finally {
      this.ws = null;
    }
  }

  private buildWsUrl(): string {
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${loc.host}/ws`;
  }
}
