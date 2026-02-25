// frontend/src/lib/wsClient.ts
import { PROTOCOL_VERSION } from "@brp/contracts";
import type { ClientToServerMsg, ServerToClientMsg } from "@brp/contracts/ws";

type JoinParams = {
  room_code: string;
  device_id: string;
  master_key?: string; // master only
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

  const isHttps = window.location.protocol === "https:";
  const proto = isHttps ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

function buildWsUrl(path: string): string {
  const base = wsBase();
  return new URL(`${base}${path}`).toString();
}

function readyStateLabel(rs: number): string {
  if (rs === 0) return "CONNECTING";
  if (rs === 1) return "OPEN";
  if (rs === 2) return "CLOSING";
  if (rs === 3) return "CLOSED";
  return String(rs);
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
    const master_key = params.master_key;

    const url = buildWsUrl("/ws");

    console.log("[WS] connecting", {
      url,
      room_code,
      device_id,
      has_master_key: !!master_key,
      pageProtocol: window.location.protocol,
      pageHost: window.location.host,
    });

    const ws = new WebSocket(url);
    this.ws = ws;

    console.log("[WS] state", readyStateLabel(ws.readyState));

    ws.onopen = (ev) => {
      console.log("[WS] open", { readyState: readyStateLabel(ws.readyState) });

      const joinMsg: ClientToServerMsg = {
        type: "JOIN_ROOM",
        payload: {
          room_code,
          device_id,
          protocol_version: PROTOCOL_VERSION,
          master_key: master_key || undefined,
        },
      };

      console.log("[WS] -> send JOIN_ROOM", {
        room_code,
        device_id,
        protocol_version: PROTOCOL_VERSION,
        has_master_key: !!master_key,
      });

      try {
        ws.send(JSON.stringify(joinMsg));
      } catch (e) {
        console.log("[WS] failed to send JOIN_ROOM", e);
      }

      handlers.onOpen?.(ev);
    };

    ws.onerror = (ev) => {
      console.log("[WS] error event", { readyState: readyStateLabel(ws.readyState), ev });
      handlers.onError?.(ev);
    };

    ws.onclose = (ev) => {
      console.log("[WS] close", {
        readyState: readyStateLabel(ws.readyState),
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
      } catch {
        console.log("[WS] message parse failed", { raw });
        return;
      }

      console.log("[WS] <- msg", msg);
      handlers.onMessage?.(msg, raw);
    };
  }
}
