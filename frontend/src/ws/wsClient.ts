import { toast } from "../components/common/Toast";

type Msg = { type: string; ts?: number; req_id?: string; payload?: any };
type Handler = (msg: Msg) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private url: string | null = null;
  private reconnect = true;
  private backoffMs = 250;

  private pending = new Map<string, { resolve: (x: any) => void; reject: (e: any) => void }>();

  onMessage(fn: Handler) {
    this.handlers.push(fn);
    return () => { this.handlers = this.handlers.filter((h) => h !== fn); };
  }

  async connect(url: string) {
    this.url = url;
    this.reconnect = true;
    await this._connectOnce();
  }

  disconnect() {
    this.reconnect = false;
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  send(msg: Msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      toast("WS non connecté");
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  request(msg: Msg): Promise<any> {
    const req_id = msg.req_id || crypto.randomUUID();
    msg.req_id = req_id;
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, reject });
      this.send(msg);
      setTimeout(() => {
        if (this.pending.has(req_id)) {
          this.pending.delete(req_id);
          reject(new Error("timeout"));
        }
      }, 8000);
    });
  }

  private async _connectOnce(): Promise<void> {
    const url = this.url!;
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => { this.backoffMs = 250; resolve(); };

      ws.onmessage = (ev) => {
        let msg: Msg | null = null;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg) return;

        if (msg.type === "ack" && msg.req_id && this.pending.has(msg.req_id)) {
          this.pending.get(msg.req_id)!.resolve(msg.payload);
          this.pending.delete(msg.req_id);
          return;
        }
        if (msg.type === "error" && msg.req_id && this.pending.has(msg.req_id)) {
          this.pending.get(msg.req_id)!.reject(msg.payload);
          this.pending.delete(msg.req_id);
          toast(msg.payload?.message || "Erreur");
          return;
        }
        if (msg.type === "error") {
          toast(msg.payload?.message || "Erreur");
        }

        this.handlers.forEach((h) => h(msg!));
      };

      ws.onclose = () => {
        this.ws = null;
        if (!this.reconnect) return;
        const wait = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 1.7, 5000);
        setTimeout(() => this._connectOnce(), wait);
      };
    });
  }
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host;
  return `${proto}://${host}${path}`;
}
