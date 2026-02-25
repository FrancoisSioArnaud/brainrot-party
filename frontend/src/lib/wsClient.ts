// frontend/src/lib/wsClient.ts
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";

type JoinParams = {
  room_code: string;
  device_id: string;
};

type Handlers = {
  onOpen?: (ev: Event) => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onMessage?: (msg: ServerToClientMsg, raw: string) => void;
};

function wsBase(): string {
  const env = (import.meta as any).env?.VITE_BACKEND_WS as string | undefined;
  if (env) return env.replace(/\/+$/, "");

  // default same origin: http(s)://host -> ws(s)://host
  const isHttps = window.location.protocol === "https:";
  const proto = isHttps ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

function buildWsUrl(path: string, qs: Record<string, string>): string {
  const base = wsBase();
  const u = new URL(`${base}${path}`);
  Object.entries(qs).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

export class BrpWsClient {
  private ws: WebSocket | null = null;

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    } finally {
      this.ws = null;
    }
  }

  send(msg: ClientToServerMsg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  connectJoinRoom(params: JoinParams, handlers: Handlers) {
    const room_code = params.room_code.trim().toUpperCase();
    const device_id = params.device_id;

    // NOTE: adapte le path si ton backend utilise un autre endpoint WS
    // (ex: "/ws" ou "/ws/room"). Ici on suppose "/ws".
    const url = buildWsUrl("/ws", { room_code, device_id });

    console.log("[WS] connecting", {
      url,
      room_code,
      device_id,
      pageProtocol: window.location.protocol,
    });

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = (ev) => {
      console.log("[WS] open");
      handlers.onOpen?.(ev);
    };

    ws.onerror = (ev) => {
      // Browser doesn't give much details here, but log it anyway
      console.log("[WS] error event", ev);
      handlers.onError?.(ev);
    };

    ws.onclose = (ev) => {
      console.log("[WS] close", {
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
      });
      handlers.onClose?.(ev);
    };

    ws.onmessage = (ev) => {
      const raw = String(ev.data ?? "");
      let msg: ServerToClientMsg | null = null;

      try {
        msg = JSON.parse(raw) as ServerToClientMsg;
      } catch (e) {
        console.log("[WS] message parse failed", { raw });
        return;
      }

      handlers.onMessage?.(msg, raw);
    };
  }
}
