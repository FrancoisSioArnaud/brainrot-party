#!/usr/bin/env bash
set -euo pipefail

# Brainrot Party frontend scaffold writer
# Creates a full React+Vite+TS+Router+Zustand scaffold with CSS Modules.
# It writes files into the CURRENT DIRECTORY.
#
# Usage:
#   chmod +x write_frontend.sh
#   ./write_frontend.sh
#
# Then:
#   npm install
#   npm run dev

ROOT="$(pwd)"

# Safety: do not overwrite existing project accidentally
if [ -e "$ROOT/package.json" ] || [ -d "$ROOT/src" ] || [ -d "$ROOT/node_modules" ]; then
  echo "ERROR: Current directory already looks like a Node/React project (package.json/src/node_modules found)."
  echo "Run this script in an EMPTY directory."
  exit 1
fi

echo "Creating Brainrot Party frontend scaffold in: $ROOT"

mkdir -p \
  src/app/layout \
  src/pages/master \
  src/pages/play \
  src/store \
  src/ws \
  src/utils \
  src/components/common \
  src/components/master/setup \
  src/components/master/lobby \
  src/components/master/game \
  src/components/play/lobby \
  src/components/play/game \
  src/styles

write_file() {
  local path="$1"
  shift
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'EOF'
'"$@"'
EOF
}

# --- Root files ---
cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brainrot Party</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > package.json <<'EOF'
{
  "name": "brainrot-party-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0 --port 5173"
  },
  "dependencies": {
    "qrcode.react": "^4.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "uuid": "^10.0.0",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.2"
  }
}
EOF

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
EOF

cat > vite.config.ts <<'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
EOF

cat > .gitignore <<'EOF'
node_modules
dist
.env
.DS_Store
EOF

# --- Global styles ---
cat > src/styles/globals.css <<'EOF'
:root {
  --bg: #0b0b0f;
  --panel: #141420;
  --panel2: #0f0f16;
  --text: #f1f1f7;
  --muted: rgba(241,241,247,0.65);
  --border: rgba(241,241,247,0.14);
  --danger: #ff4d4f;
  --ok: #52c41a;
  --warn: #faad14;
  --shadow: 0 10px 30px rgba(0,0,0,0.35);
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}

a { color: inherit; text-decoration: none; }
button, input { font: inherit; }
button { cursor: pointer; }
EOF

# --- Entry ---
cat > src/main.tsx <<'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
EOF

# --- Router & shells ---
cat > src/app/router.tsx <<'EOF'
import React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import MasterShell from "./layout/MasterShell";
import PlayShell from "./layout/PlayShell";

import MasterLanding from "../pages/master/Landing";
import MasterSetup from "../pages/master/Setup";
import MasterLobby from "../pages/master/Lobby";
import MasterGame from "../pages/master/Game";

import PlayEnterCode from "../pages/play/EnterCode";
import PlayChoosePlayer from "../pages/play/ChoosePlayer";
import PlayWait from "../pages/play/Wait";
import PlayGame from "../pages/play/Game";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/master" replace />
  },
  {
    path: "/master",
    element: <MasterShell />,
    children: [
      { index: true, element: <MasterLanding /> },
      { path: "setup", element: <MasterSetup /> },
      { path: "lobby", element: <MasterLobby /> },
      { path: "game/:roomCode", element: <MasterGame /> }
    ]
  },
  {
    path: "/play",
    element: <PlayShell />,
    children: [
      { index: true, element: <PlayEnterCode /> },
      { path: "choose/:joinCode", element: <PlayChoosePlayer /> },
      { path: "wait/:joinCode", element: <PlayWait /> },
      { path: "game/:roomCode", element: <PlayGame /> }
    ]
  }
]);
EOF

cat > src/app/layout/MasterShell.tsx <<'EOF'
import React from "react";
import { Outlet } from "react-router-dom";
import styles from "./MasterShell.module.css";
import ToastHost from "../../components/common/Toast";

export default function MasterShell() {
  return (
    <div className={styles.root}>
      <ToastHost />
      <Outlet />
    </div>
  );
}
EOF

cat > src/app/layout/MasterShell.module.css <<'EOF'
.root {
  min-height: 100vh;
  padding: 20px;
}
EOF

cat > src/app/layout/PlayShell.tsx <<'EOF'
import React from "react";
import { Outlet } from "react-router-dom";
import styles from "./PlayShell.module.css";
import ToastHost from "../../components/common/Toast";

export default function PlayShell() {
  return (
    <div className={styles.root}>
      <ToastHost />
      <Outlet />
    </div>
  );
}
EOF

cat > src/app/layout/PlayShell.module.css <<'EOF'
.root {
  min-height: 100vh;
  padding: 16px;
}
EOF

# --- Utils ---
cat > src/utils/ids.ts <<'EOF'
import { v4 as uuidv4 } from "uuid";

export function uuid(): string {
  return uuidv4();
}

export function getOrCreateDeviceId(): string {
  const key = "brp_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = uuidv4();
  localStorage.setItem(key, id);
  return id;
}
EOF

cat > src/utils/time.ts <<'EOF'
export function nowMs(): number {
  return Date.now();
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}
EOF

cat > src/utils/deterministicColor.ts <<'EOF'
const PALETTE = ["c1","c2","c3","c4","c5","c6","c7","c8","c9","c10","c11","c12"];

export function colorTokenFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
EOF

cat > src/utils/normalizeInstagramUrl.ts <<'EOF'
export type NormalizeResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const RE = /^https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i;

export function normalizeInstagramUrl(raw: string): NormalizeResult {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "empty" };
  const s = raw.trim();
  const m = s.match(RE);
  if (!m) return { ok: false, reason: "pattern_mismatch" };
  const kind = m[2].toLowerCase();
  const shortcode = m[3];
  const url = `https://www.instagram.com/${kind}/${shortcode}/`;
  return { ok: true, url };
}
EOF

cat > src/utils/parseInstagramJson.ts <<'EOF'
import { normalizeInstagramUrl } from "./normalizeInstagramUrl";

export type ParsedFileReport = {
  messages_found: number;
  participants_found: number;
  errors_count: number;
  rejected_urls: string[];
  sender_to_urls: Record<string, string[]>; // sender name => normalized urls (dedup within sender)
};

function safeGetSenderName(msg: any): string | null {
  // Instagram exports vary; try common keys
  return (
    msg?.sender_name ??
    msg?.sender ??
    msg?.from ??
    msg?.user ??
    msg?.profile ??
    null
  );
}

function safeGetShareLink(msg: any): string | null {
  // spec: messages[].share.link
  return msg?.share?.link ?? null;
}

export function parseInstagramExportJson(json: any): ParsedFileReport {
  const messages: any[] = Array.isArray(json?.messages) ? json.messages : [];
  const sender_to_urls: Record<string, Set<string>> = {};
  const rejected_urls: string[] = [];

  for (const msg of messages) {
    const sender = safeGetSenderName(msg);
    const link = safeGetShareLink(msg);
    if (!sender || !link) continue;

    const norm = normalizeInstagramUrl(link);
    if (!norm.ok) {
      rejected_urls.push(link);
      continue;
    }

    if (!sender_to_urls[sender]) sender_to_urls[sender] = new Set<string>();
    sender_to_urls[sender].add(norm.url);
  }

  const participants_found = Object.keys(sender_to_urls).length;

  const out: Record<string, string[]> = {};
  for (const [sender, set] of Object.entries(sender_to_urls)) out[sender] = Array.from(set);

  return {
    messages_found: messages.length,
    participants_found,
    errors_count: rejected_urls.length,
    rejected_urls,
    sender_to_urls: out
  };
}
EOF

# --- Common components ---
cat > src/components/common/SpinnerOverlay.tsx <<'EOF'
import React from "react";
import styles from "./SpinnerOverlay.module.css";

export default function SpinnerOverlay({ open, text }: { open: boolean; text?: string }) {
  if (!open) return null;
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <div className={styles.spinner} />
        <div className={styles.text}>{text || "Chargement…"}</div>
      </div>
    </div>
  );
}
EOF

cat > src/components/common/SpinnerOverlay.module.css <<'EOF'
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: grid;
  place-items: center;
  z-index: 9999;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid rgba(241,241,247,0.2);
  border-top-color: rgba(241,241,247,0.9);
  animation: spin 0.9s linear infinite;
}
.text { color: var(--text); font-weight: 600; }
@keyframes spin { to { transform: rotate(360deg); } }
EOF

cat > src/components/common/Modal.tsx <<'EOF'
import React from "react";
import styles from "./Modal.module.css";

export default function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>{title || ""}</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
EOF

cat > src/components/common/Modal.module.css <<'EOF'
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 16px;
}
.card {
  width: min(1000px, 100%);
  max-height: min(82vh, 900px);
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
}
.header {
  position: sticky;
  top: 0;
  background: linear-gradient(to bottom, var(--panel), rgba(20,20,32,0.85));
  border-bottom: 1px solid var(--border);
  padding: 14px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title { font-weight: 700; }
.close {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 6px 10px;
  border-radius: 10px;
}
.body { padding: 14px; }
EOF

cat > src/components/common/Avatar.tsx <<'EOF'
import React from "react";
import styles from "./Avatar.module.css";

export default function Avatar({
  src,
  size = 40,
  label
}: {
  src?: string | null;
  size?: number;
  label?: string;
}) {
  return (
    <div className={styles.wrap} style={{ width: size, height: size }} aria-label={label || "avatar"}>
      {src ? <img className={styles.img} src={src} alt={label || "avatar"} /> : <div className={styles.placeholder}>👤</div>}
    </div>
  );
}
EOF

cat > src/components/common/Avatar.module.css <<'EOF'
.wrap {
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.06);
  display: grid;
  place-items: center;
}
.img { width: 100%; height: 100%; object-fit: cover; }
.placeholder { font-size: 18px; opacity: 0.9; }
EOF

cat > src/components/common/QRCode.tsx <<'EOF'
import React from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function QRCode({ value, size = 140 }: { value: string; size?: number }) {
  return <QRCodeCanvas value={value} size={size} includeMargin />;
}
EOF

# Minimal Toast (global singleton)
cat > src/components/common/Toast.tsx <<'EOF'
import React, { useEffect, useState } from "react";
import styles from "./Toast.module.css";

type ToastItem = { id: string; message: string };

let listeners: Array<(items: ToastItem[]) => void> = [];
let items: ToastItem[] = [];

export function toast(message: string) {
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  items = [...items, { id, message }];
  listeners.forEach((l) => l(items));
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    listeners.forEach((l) => l(items));
  }, 3000);
}

export default function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    const fn = (x: ToastItem[]) => setList(x);
    listeners.push(fn);
    fn(items);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);

  if (list.length === 0) return null;
  return (
    <div className={styles.host}>
      {list.map((t) => (
        <div key={t.id} className={styles.toast}>{t.message}</div>
      ))}
    </div>
  );
}
EOF

cat > src/components/common/Toast.module.css <<'EOF'
.host {
  position: fixed;
  top: 14px;
  right: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10000;
}
.toast {
  background: rgba(20,20,32,0.95);
  border: 1px solid var(--border);
  padding: 10px 12px;
  border-radius: 12px;
  box-shadow: var(--shadow);
  color: var(--text);
  max-width: 360px;
  font-weight: 600;
}
EOF

# --- WS client ---
cat > src/ws/wsClient.ts <<'EOF'
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
EOF

# Placeholder lobby/game client wrappers
cat > src/ws/lobbyClient.ts <<'EOF'
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
      if (msg.type === "player_list_updated" && this.state) {
        this.state = { ...this.state, players: msg.payload.players };
        this.onState?.(this.state);
      }
      if (msg.type === "player_updated" && this.state) {
        const p = msg.payload.player as LobbyPlayer;
        this.state = { ...this.state, players: this.state.players.map(x => x.id === p.id ? p : x) };
        this.onState?.(this.state);
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
  }

  async claimPlayer(device_id: string, player_id: string) {
    // server returns targeted player_claimed with token; this is simplified
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

  setPlayerPhotoRef(device_id: string, player_id: string, token: string, photo_url: string) {
    this.ws.send({ type: "set_player_photo_ref", payload: { device_id, player_id, player_session_token: token, photo_url } });
  }
}
EOF

cat > src/ws/gameClient.ts <<'EOF'
import { WSClient, wsUrl } from "./wsClient";

export class GameClient {
  ws = new WSClient();

  async connectMaster(roomCode: string) {
    await this.ws.connect(wsUrl(`/ws/game/${roomCode}?role=master`));
  }

  async connectPlay(roomCode: string) {
    await this.ws.connect(wsUrl(`/ws/game/${roomCode}?role=play`));
  }

  masterHello(room_code: string, master_key: string) {
    this.ws.send({ type: "master_hello", payload: { room_code, master_key } });
  }

  playHello(room_code: string, device_id: string, player_id: string, token: string) {
    this.ws.send({ type: "play_hello", payload: { room_code, device_id, player_id, player_session_token: token } });
  }

  masterOpenReel(master_key: string, item_id: string) {
    this.ws.send({ type: "master_open_reel", payload: { master_key, item_id } });
  }

  masterStartTimer(master_key: string, item_id: string, duration_seconds: number) {
    this.ws.send({ type: "master_start_timer", payload: { master_key, item_id, duration_seconds } });
  }

  castVote(player_id: string, token: string, item_id: string, sender_ids: string[]) {
    this.ws.send({ type: "cast_vote", payload: { player_id, player_session_token: token, item_id, sender_ids } });
  }
}
EOF

# --- Stores (minimal skeletons) ---
cat > src/store/draftStore.ts <<'EOF'
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "../utils/ids";
import { parseInstagramExportJson } from "../utils/parseInstagramJson";

export type DraftFile = {
  id: string;
  name: string;
  messages_found: number;
  participants_found: number;
  errors_count: number;
  rejected_urls: string[];
};

export type DraftSenderOccurrence = {
  file_id: string;
  file_name: string;
  participant_name: string;
  reel_count: number;
};

export type DraftSender = {
  sender_id_local: string;
  display_name: string;
  occurrences: DraftSenderOccurrence[];
  reel_urls: string[]; // unique normalized
  reel_count_total: number;
  active: boolean;
  hidden: boolean;
  badge: "none" | "auto" | "manual";
};

export type DraftStats = {
  active_senders: number;
  reel_items: number;
  rounds_max: number | null;
  rounds_complete: number | null;
  dedup_senders: number;
  rejected_total: number;
};

export type Draft = {
  local_room_id: string | null;
  files: DraftFile[];
  senders: DraftSender[];
  reelItemsByUrl: Record<string, { url: string; sender_local_ids: string[] }>;
  stats: DraftStats;
  join_code?: string;
  master_key?: string;
};

type DraftState = Draft & {
  createLocalRoom: () => void;
  reset: () => void;
  importFiles: (files: File[]) => Promise<void>;
  removeFile: (fileId: string) => void;
  toggleSenderActive: (senderId: string) => void;
  renameSender: (senderId: string, name: string) => void;
  setJoin: (join_code: string, master_key: string) => void;
};

const EMPTY_STATS: DraftStats = {
  active_senders: 0,
  reel_items: 0,
  rounds_max: null,
  rounds_complete: null,
  dedup_senders: 0,
  rejected_total: 0
};

function computeStats(senders: DraftSender[], reelItemsByUrl: Draft["reelItemsByUrl"], files: DraftFile[]): DraftStats {
  const visible = senders.filter(s => !s.hidden);
  const active = visible.filter(s => s.active && s.reel_count_total > 0);
  const activeCounts = active.map(s => s.reel_count_total).sort((a,b)=>b-a);

  const rounds_max = activeCounts.length >= 2 ? activeCounts[1] : null;
  const rounds_complete = activeCounts.length >= 1 ? Math.min(...activeCounts) : null;

  const activeSenderIds = new Set(active.map(s => s.sender_id_local));
  let reel_items = 0;
  for (const it of Object.values(reelItemsByUrl)) {
    if (it.sender_local_ids.some(id => activeSenderIds.has(id))) reel_items += 1;
  }

  const rejected_total = files.reduce((sum, f) => sum + (f.errors_count || 0), 0);

  return {
    active_senders: active.length,
    reel_items,
    rounds_max,
    rounds_complete,
    dedup_senders: active.length,
    rejected_total
  };
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      local_room_id: null,
      files: [],
      senders: [],
      reelItemsByUrl: {},
      stats: EMPTY_STATS,

      createLocalRoom: () => {
        const id = uuid();
        set({ local_room_id: id, files: [], senders: [], reelItemsByUrl: {}, stats: EMPTY_STATS });
      },

      reset: () => {
        set({ local_room_id: null, files: [], senders: [], reelItemsByUrl: {}, stats: EMPTY_STATS, join_code: undefined, master_key: undefined });
      },

      setJoin: (join_code, master_key) => set({ join_code, master_key }),

      importFiles: async (files: File[]) => {
        // Parse all in-memory (MVP). Append.
        const current = get().files;
        const currentSenders = get().senders;
        const currentReelMap = { ...get().reelItemsByUrl };

        const newFileRows: DraftFile[] = [];
        const fileSenderUrls: Array<{ fileRow: DraftFile; sender_to_urls: Record<string,string[]> }> = [];

        for (const f of files) {
          const text = await f.text();
          let json: any = null;
          try { json = JSON.parse(text); } catch {
            const fileRow: DraftFile = { id: uuid(), name: f.name, messages_found: 0, participants_found: 0, errors_count: 1, rejected_urls: ["INVALID_JSON"] };
            newFileRows.push(fileRow);
            fileSenderUrls.push({ fileRow, sender_to_urls: {} });
            continue;
          }
          const rep = parseInstagramExportJson(json);
          const fileRow: DraftFile = {
            id: uuid(),
            name: f.name,
            messages_found: rep.messages_found,
            participants_found: rep.participants_found,
            errors_count: rep.errors_count,
            rejected_urls: rep.rejected_urls
          };
          newFileRows.push(fileRow);
          fileSenderUrls.push({ fileRow, sender_to_urls: rep.sender_to_urls });
        }

        // Build senders with auto-merge strict by name (cross files)
        const senderMap: Record<string, DraftSender> = {};
        const allFiles = [...current, ...newFileRows];

        // Rebuild from scratch from fileSenderUrls + existing ones is more correct, but MVP: merge in
        // For correctness, rebuild from scratch using current files data is needed (later).
        // Here: merge-in new files.
        for (const { fileRow, sender_to_urls } of fileSenderUrls) {
          for (const [senderName, urls] of Object.entries(sender_to_urls)) {
            if (!senderMap[senderName]) {
              // Try to reuse existing sender if exists
              const existing = currentSenders.find(s => s.display_name === senderName && !s.hidden);
              senderMap[senderName] = existing ? { ...existing } : {
                sender_id_local: uuid(),
                display_name: senderName,
                occurrences: [],
                reel_urls: [],
                reel_count_total: 0,
                active: true,
                hidden: false,
                badge: "none"
              };
            }
            const s = senderMap[senderName];
            s.occurrences = [...(s.occurrences || []), { file_id: fileRow.id, file_name: fileRow.name, participant_name: senderName, reel_count: urls.length }];
            const setUrls = new Set([...(s.reel_urls || []), ...urls]);
            s.reel_urls = Array.from(setUrls);
            s.reel_count_total = s.reel_urls.length;
            // Badge auto if appears in multiple files
            const fileSet = new Set(s.occurrences.map(o => o.file_id));
            s.badge = fileSet.size >= 2 ? "auto" : s.badge;
          }
        }

        // Merge senderMap with existing senders that weren't touched
        const mergedSenders: DraftSender[] = [
          ...currentSenders.filter(s => !Object.keys(senderMap).includes(s.display_name)),
          ...Object.values(senderMap)
        ];

        // Rebuild reelItemsByUrl with new urls (MVP merge)
        for (const s of Object.values(senderMap)) {
          for (const url of s.reel_urls) {
            if (!currentReelMap[url]) currentReelMap[url] = { url, sender_local_ids: [] };
            if (!currentReelMap[url].sender_local_ids.includes(s.sender_id_local)) {
              currentReelMap[url].sender_local_ids.push(s.sender_id_local);
            }
          }
        }

        const stats = computeStats(mergedSenders, currentReelMap, allFiles);
        set({ files: allFiles, senders: mergedSenders, reelItemsByUrl: currentReelMap, stats });
      },

      removeFile: (fileId: string) => {
        // MVP: remove file row only. Full rebuild should be implemented.
        const files = get().files.filter(f => f.id !== fileId);
        set({ files });
        set({ stats: computeStats(get().senders, get().reelItemsByUrl, files) });
      },

      toggleSenderActive: (senderId: string) => {
        const senders = get().senders.map(s => s.sender_id_local === senderId ? { ...s, active: !s.active } : s);
        const stats = computeStats(senders, get().reelItemsByUrl, get().files);
        set({ senders, stats });
      },

      renameSender: (senderId: string, name: string) => {
        const senders = get().senders.map(s => s.sender_id_local === senderId ? { ...s, display_name: name } : s);
        set({ senders });
      }
    }),
    { name: "brp_draft_v1" }
  )
);
EOF

cat > src/store/lobbyStore.ts <<'EOF'
import { create } from "zustand";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: "free" | "connected" | "afk" | "disabled";
  photo_url: string | null;
};

type LobbyState = {
  join_code: string | null;
  master_key: string | null;
  players: LobbyPlayer[];
  readyToStart: boolean;
  setLobby: (join_code: string, master_key: string) => void;
  setPlayers: (players: LobbyPlayer[]) => void;
};

export const useLobbyStore = create<LobbyState>((set, get) => ({
  join_code: null,
  master_key: null,
  players: [],
  readyToStart: false,

  setLobby: (join_code, master_key) => set({ join_code, master_key }),

  setPlayers: (players) => {
    const active = players.filter(p => p.active && p.status !== "disabled");
    const ready =
      active.length >= 2 &&
      active.every(p => p.status === "connected" || p.status === "afk");
    set({ players, readyToStart: ready });
  }
}));
EOF

cat > src/store/gameStore.ts <<'EOF'
import { create } from "zustand";

export type GameSender = { id: string; name: string; photo_url: string | null; color_token?: string; active: boolean };
export type GamePlayer = { id: string; name: string; photo_url: string | null; active: boolean; score: number; connected?: boolean };

export type RoundItemSummary = { id: string; k: number; opened: boolean; resolved: boolean };

type GameRoom = {
  room_code: string;
  status: "IN_GAME" | "GAME_END";
  phase: string;
  current_round_index: number;
  current_item_index: number;
  timer_end_ts: number | null;
};

type GameState = {
  room: GameRoom | null;
  senders: GameSender[];
  players: GamePlayer[];
  items: RoundItemSummary[];
  focus_item_id: string | null;

  remaining_sender_ids: string[];
  revealed_slots_by_item: Record<string, string[]>;
  current_votes_by_player: Record<string, string[]>;

  reel_urls_by_item?: Record<string, string>; // master-only

  applyStateSync: (payload: any) => void;
  applyRevealStep: (payload: any) => void;
};

export const useGameStore = create<GameState>((set, get) => ({
  room: null,
  senders: [],
  players: [],
  items: [],
  focus_item_id: null,
  remaining_sender_ids: [],
  revealed_slots_by_item: {},
  current_votes_by_player: {},

  applyStateSync: (p) => {
    set({
      room: p.room,
      senders: p.senders || [],
      players: p.players || [],
      items: p.round?.items_ordered || [],
      focus_item_id: p.round?.focus_item_id || null,
      remaining_sender_ids: p.ui_state?.remaining_sender_ids || [],
      revealed_slots_by_item: p.ui_state?.revealed_slots_by_item || {},
      current_votes_by_player: p.ui_state?.current_votes_by_player || {},
      reel_urls_by_item: p.ui_state?.reel_urls_by_item
    });
  },

  applyRevealStep: (payload) => {
    // The UI components will interpret payload; store minimal shared fields
    if (payload.step === 4 && payload.scores) {
      const players = get().players.map(pl => ({
        ...pl,
        score: payload.scores[pl.id] ?? pl.score
      }));
      set({ players });
    }
    if (payload.step === 5) {
      if (payload.remaining_sender_ids) set({ remaining_sender_ids: payload.remaining_sender_ids });
      if (payload.item_id && payload.truth_sender_ids) {
        const cur = { ...get().revealed_slots_by_item };
        cur[payload.item_id] = payload.truth_sender_ids;
        set({ revealed_slots_by_item: cur });
      }
    }
    if (payload.step === 6) {
      set({ current_votes_by_player: {} });
    }
  }
}));
EOF

# --- Master Pages (minimal) ---
cat > src/pages/master/Landing.tsx <<'EOF'
import React from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import styles from "./Landing.module.css";

export default function MasterLanding() {
  const nav = useNavigate();
  const create = useDraftStore(s => s.createLocalRoom);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Brainrot Party</h1>
      <button
        className={styles.primary}
        onClick={() => {
          create();
          nav("/master/setup");
        }}
      >
        Create room
      </button>
    </div>
  );
}
EOF

cat > src/pages/master/Landing.module.css <<'EOF'
.root {
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  padding-top: 40px;
}
.title { margin: 0; font-size: 34px; }
.primary {
  width: fit-content;
  padding: 12px 18px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.08);
  color: var(--text);
  font-weight: 800;
}
EOF

cat > src/pages/master/Setup.tsx <<'EOF'
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import SpinnerOverlay from "../../components/common/SpinnerOverlay";
import { toast } from "../../components/common/Toast";
import styles from "./Setup.module.css";

import ImportSection from "../../components/master/setup/ImportSection";
import FusionSection from "../../components/master/setup/FusionSection";
import ActivationSection from "../../components/master/setup/ActivationSection";
import StatsPanel from "../../components/master/setup/StatsPanel";
import StickyPrimaryButton from "../../components/master/setup/StickyPrimaryButton";

async function openLobbyHttp(): Promise<{ join_code: string; master_key: string }> {
  // Backend should implement this: POST /lobby/open
  // For now, placeholder to unblock UI.
  const res = await fetch("/lobby/open", { method: "POST" });
  if (!res.ok) throw new Error("open lobby failed");
  return await res.json();
}

export default function MasterSetup() {
  const nav = useNavigate();
  const local_room_id = useDraftStore(s => s.local_room_id);
  const files = useDraftStore(s => s.files);
  const stats = useDraftStore(s => s.stats);
  const setJoin = useDraftStore(s => s.setJoin);
  const reset = useDraftStore(s => s.reset);

  const [busy, setBusy] = useState(false);

  const canConnect = useMemo(() => {
    return (files.length >= 1) && ((stats.active_senders || 0) >= 2);
  }, [files.length, stats.active_senders]);

  if (!local_room_id) {
    nav("/master", { replace: true });
    return null;
  }

  return (
    <div className={styles.grid}>
      <SpinnerOverlay open={busy} text="J’en ai pour un instant…" />

      <div className={styles.left}>
        <div className={styles.section}>
          <ImportSection />
        </div>

        <div className={styles.section}>
          <FusionSection />
        </div>

        <div className={styles.section}>
          <ActivationSection />
        </div>

        <StickyPrimaryButton
          label="Connecter les joueurs"
          disabled={!canConnect || busy}
          onClick={async () => {
            try {
              setBusy(true);
              const { join_code, master_key } = await openLobbyHttp();
              setJoin(join_code, master_key);
              nav("/master/lobby");
            } catch (e: any) {
              toast("Impossible d’ouvrir le lobby");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>

      <div className={styles.right}>
        <StatsPanel />
        <button
          className={styles.reset}
          onClick={() => {
            if (!confirm("Réinitialiser ma room ?")) return;
            reset();
            nav("/master");
          }}
        >
          Réinitialiser ma room
        </button>
      </div>
    </div>
  );
}
EOF

cat > src/pages/master/Setup.module.css <<'EOF'
.grid {
  display: grid;
  grid-template-columns: 1.65fr 1fr;
  gap: 16px;
  align-items: start;
}
.left { display: flex; flex-direction: column; gap: 16px; }
.right { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 12px; }
.section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
  box-shadow: var(--shadow);
}
.reset {
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.04);
  color: var(--text);
  font-weight: 800;
}
@media (max-width: 980px) {
  .grid { grid-template-columns: 1fr; }
  .right { position: static; }
}
EOF

cat > src/pages/master/Lobby.tsx <<'EOF'
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import { useLobbyStore } from "../../store/lobbyStore";
import { LobbyClient } from "../../ws/lobbyClient";
import { toast } from "../../components/common/Toast";
import styles from "./Lobby.module.css";
import JoinCodePanel from "../../components/master/lobby/JoinCodePanel";
import PlayersGrid from "../../components/master/lobby/PlayersGrid";
import StartGameBar from "../../components/master/lobby/StartGameBar";

export default function MasterLobby() {
  const nav = useNavigate();
  const draft = useDraftStore(s => s);
  const join_code = draft.join_code;
  const master_key = draft.master_key;
  const local_room_id = draft.local_room_id;

  const setPlayers = useLobbyStore(s => s.setPlayers);
  const ready = useLobbyStore(s => s.readyToStart);
  const players = useLobbyStore(s => s.players);

  const clientRef = useRef<LobbyClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!join_code || !master_key || !local_room_id) {
      nav("/master/setup", { replace: true });
      return;
    }
    const client = new LobbyClient();
    clientRef.current = client;
    client.bind();
    client.onState = (st) => {
      setPlayers(st.players as any);
      setConnected(true);
    };

    (async () => {
      try {
        await client.connectMaster(join_code);
        client.masterHello(master_key, local_room_id);
        // push draft immediately
        client.syncFromDraft(master_key, {
          local_room_id,
          senders_active: draft.senders.filter(s => !s.hidden && s.active && s.reel_count_total > 0).map(s => ({ id_local: s.sender_id_local, name: s.display_name, active: true })),
          players: [] // server will create auto players if it wants; keeping minimal here
        });
      } catch {
        toast("WS lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [join_code, master_key, local_room_id]);

  const activeCount = useMemo(() => players.filter(p => p.active && p.status !== "disabled").length, [players]);

  if (!join_code || !master_key) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <JoinCodePanel joinCode={join_code} />
        <div className={styles.meta}>
          <div className={styles.line}><span className={styles.k}>Connectés / actifs</span> <span className={styles.v}>{connected ? "" : "(WS…)"} {activeCount}</span></div>
        </div>
      </div>

      <PlayersGrid
        players={players}
        onCreate={async () => {
          const name = prompt("Nom du player ?") || "Player";
          clientRef.current?.createManualPlayer(master_key, name);
        }}
        onDelete={(id) => clientRef.current?.deletePlayer(master_key, id)}
        onToggleActive={(id, active) => clientRef.current?.setPlayerActive(master_key, id, active)}
      />

      <StartGameBar
        ready={ready}
        onBackSetup={() => nav("/master/setup")}
        onStart={async () => {
          clientRef.current?.startGame(master_key, local_room_id!);
        }}
      />
    </div>
  );
}
EOF

cat > src/pages/master/Lobby.module.css <<'EOF'
.root { display: grid; gap: 14px; max-width: 1100px; margin: 0 auto; }
.header { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; }
.meta {
  flex: 1;
  min-width: 240px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
  box-shadow: var(--shadow);
}
.line { display: flex; justify-content: space-between; }
.k { color: var(--muted); font-weight: 700; }
.v { font-weight: 900; }
EOF

cat > src/pages/master/Game.tsx <<'EOF'
import React, { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import { useGameStore } from "../../store/gameStore";
import { GameClient } from "../../ws/gameClient";
import { toast } from "../../components/common/Toast";
import styles from "./Game.module.css";

import ReelsPanel from "../../components/master/game/ReelsPanel";
import RemainingSendersBar from "../../components/master/game/RemainingSendersBar";
import PlayersBar from "../../components/master/game/PlayersBar";
import Leaderboard from "../../components/master/game/Leaderboard";
import TimerButton from "../../components/master/game/TimerButton";

export default function MasterGame() {
  const { roomCode } = useParams();
  const master_key = useDraftStore(s => s.master_key);
  const applyStateSync = useGameStore(s => s.applyStateSync);
  const applyRevealStep = useGameStore(s => s.applyRevealStep);

  const clientRef = useRef<GameClient | null>(null);

  useEffect(() => {
    if (!roomCode || !master_key) return;
    const client = new GameClient();
    clientRef.current = client;

    client.ws.onMessage((msg) => {
      if (msg.type === "state_sync") applyStateSync(msg.payload);
      if (msg.type === "reveal_step") applyRevealStep(msg.payload);
      if (msg.type === "focus_changed") {
        // handled by next state_sync in backend; optional local patch
      }
    });

    (async () => {
      try {
        await client.connectMaster(roomCode);
        client.masterHello(roomCode, master_key);
      } catch {
        toast("WS game indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [roomCode, master_key]);

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <ReelsPanel onOpen={(item_id, url) => {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          clientRef.current?.masterOpenReel(master_key!, item_id);
        }} />
        <div className={styles.side}>
          <Leaderboard />
          <TimerButton onStart={(item_id) => clientRef.current?.masterStartTimer(master_key!, item_id, 10)} />
        </div>
      </div>

      <RemainingSendersBar />
      <PlayersBar />
    </div>
  );
}
EOF

cat > src/pages/master/Game.module.css <<'EOF'
.root { display: grid; gap: 14px; }
.top { display: grid; grid-template-columns: 1.6fr 0.9fr; gap: 14px; align-items: start; }
.side { display: grid; gap: 12px; }
@media (max-width: 980px) { .top { grid-template-columns: 1fr; } }
EOF

# --- Play pages minimal ---
cat > src/pages/play/EnterCode.tsx <<'EOF'
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./EnterCode.module.css";

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [code, setCode] = useState("");

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Rejoindre</h1>
      <input
        className={styles.input}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="AB12CD"
        maxLength={6}
      />
      <button className={styles.primary} onClick={() => nav(`/play/choose/${encodeURIComponent(code.trim())}`)}>
        Rejoindre
      </button>
    </div>
  );
}
EOF

cat > src/pages/play/EnterCode.module.css <<'EOF'
.root { max-width: 520px; margin: 0 auto; padding-top: 40px; display: grid; gap: 12px; }
.title { margin: 0; font-size: 28px; }
.input {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.06);
  color: var(--text);
  font-weight: 900;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.primary {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.10);
  color: var(--text);
  font-weight: 900;
}
EOF

cat > src/pages/play/ChoosePlayer.tsx <<'EOF'
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LobbyClient, LobbyPlayer } from "../../ws/lobbyClient";
import { getOrCreateDeviceId } from "../../utils/ids";
import { toast } from "../../components/common/Toast";
import PlayersList from "../../components/play/lobby/PlayersList";
import styles from "./ChoosePlayer.module.css";

export default function PlayChoosePlayer() {
  const { joinCode } = useParams();
  const nav = useNavigate();
  const device_id = getOrCreateDeviceId();

  const clientRef = useRef<LobbyClient | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);

  useEffect(() => {
    if (!joinCode) return;
    const client = new LobbyClient();
    clientRef.current = client;
    client.bind();
    client.onState = (st) => setPlayers(st.players as any);

    client.ws.onMessage((msg) => {
      if (msg.type === "player_claimed") {
        // if server targets token per device, handle that; placeholder expects token broadcasted
      }
      if (msg.type === "player_kicked") {
        toast(msg.payload?.message || "Kicked");
      }
      if (msg.type === "lobby_closed" && msg.payload?.room_code) {
        nav(`/play/game/${msg.payload.room_code}`, { replace: true });
      }
    });

    (async () => {
      try {
        await client.connectPlay(joinCode);
        client.playHello(device_id);
      } catch {
        toast("Lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [joinCode]);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Choisir un player</h1>
      <PlayersList
        players={players.filter(p => p.active && p.status !== "disabled")}
        onPick={(p) => {
          // send claim; token must be received from server (targeted)
          clientRef.current?.claimPlayer(device_id, p.id);
          toast("Choix envoyé. Attends la confirmation.");
          // In real impl: navigate after receiving token; placeholder:
        }}
      />
      <div className={styles.note}>Si ton player est pris, choisis-en un autre.</div>
    </div>
  );
}
EOF

cat > src/pages/play/ChoosePlayer.module.css <<'EOF'
.root { max-width: 640px; margin: 0 auto; padding-top: 24px; display: grid; gap: 12px; }
.title { margin: 0; font-size: 26px; }
.note { color: var(--muted); font-weight: 700; }
EOF

cat > src/pages/play/Wait.tsx <<'EOF'
import React from "react";
import { useParams } from "react-router-dom";
import styles from "./Wait.module.css";

export default function PlayWait() {
  const { joinCode } = useParams();
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Connecté</h1>
      <div className={styles.text}>Code: {joinCode}</div>
      <div className={styles.text}>Le jeu va bientôt commencer.</div>
      <div className={styles.note}>Cette page sera câblée avec rename/photo/change slot.</div>
    </div>
  );
}
EOF

cat > src/pages/play/Wait.module.css <<'EOF'
.root { max-width: 520px; margin: 0 auto; padding-top: 40px; display: grid; gap: 10px; }
.title { margin: 0; font-size: 28px; }
.text { font-weight: 800; }
.note { color: var(--muted); font-weight: 700; }
EOF

cat > src/pages/play/Game.tsx <<'EOF'
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { GameClient } from "../../ws/gameClient";
import { useGameStore } from "../../store/gameStore";
import { getOrCreateDeviceId } from "../../utils/ids";
import VotePage from "./Vote";
import styles from "./Game.module.css";

export default function PlayGame() {
  const { roomCode } = useParams();
  const device_id = getOrCreateDeviceId();

  const applyStateSync = useGameStore(s => s.applyStateSync);
  const applyRevealStep = useGameStore(s => s.applyRevealStep);
  const room = useGameStore(s => s.room);

  const clientRef = useRef<GameClient | null>(null);
  const [auth, setAuth] = useState<{ player_id: string; token: string } | null>(null);

  useEffect(() => {
    // In real: load from localStorage after claim
    const pid = localStorage.getItem("brp_player_id");
    const tok = localStorage.getItem("brp_player_token");
    if (pid && tok) setAuth({ player_id: pid, token: tok });
  }, []);

  useEffect(() => {
    if (!roomCode || !auth) return;
    const client = new GameClient();
    clientRef.current = client;

    client.ws.onMessage((msg) => {
      if (msg.type === "state_sync") applyStateSync(msg.payload);
      if (msg.type === "reveal_step") applyRevealStep(msg.payload);
      if (msg.type === "voting_started") {
        // state_sync should follow; keeping simple
      }
    });

    (async () => {
      await client.connectPlay(roomCode);
      client.playHello(roomCode, device_id, auth.player_id, auth.token);
    })();

    return () => client.ws.disconnect();
  }, [roomCode, auth]);

  const phase = room?.phase || "WAIT";
  const isVoting = phase === "VOTING" || phase === "TIMER_RUNNING";

  return (
    <div className={styles.root}>
      {isVoting ? <VotePage client={clientRef.current} auth={auth} /> : <div className={styles.wait}>En attente du prochain vote…</div>}
    </div>
  );
}
EOF

cat > src/pages/play/Game.module.css <<'EOF'
.root { max-width: 720px; margin: 0 auto; padding-top: 10px; }
.wait {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  font-weight: 900;
}
EOF

cat > src/pages/play/Vote.tsx <<'EOF'
import React, { useMemo, useState } from "react";
import { useGameStore } from "../../store/gameStore";
import VoteGrid from "../../components/play/game/VoteGrid";
import VoteFooter from "../../components/play/game/VoteFooter";
import { toast } from "../../components/common/Toast";
import { GameClient } from "../../ws/gameClient";

export default function VotePage({ client, auth }: { client: GameClient | null; auth: { player_id: string; token: string } | null }) {
  const senders = useGameStore(s => s.senders);
  const items = useGameStore(s => s.items);
  const focus_item_id = useGameStore(s => s.focus_item_id);

  const focus = useMemo(() => items.find(i => i.id === focus_item_id) || null, [items, focus_item_id]);
  const k = focus?.k || 1;

  const [sel, setSel] = useState<string[]>([]);

  function toggle(id: string) {
    setSel((cur) => {
      const has = cur.includes(id);
      if (has) return cur.filter(x => x !== id);
      if (cur.length >= k) return cur; // max k
      return [...cur, id];
    });
  }

  return (
    <div>
      <h1 style={{ margin: "10px 0" }}>{k} users à sélectionner</h1>
      <VoteGrid senders={senders.filter(s => s.active)} selected={sel} onToggle={toggle} />
      <VoteFooter
        selectedCount={sel.length}
        k={k}
        onSubmit={() => {
          if (!auth || !client || !focus_item_id) return;
          if (sel.length < k) {
            toast(`Sélectionne encore ${k - sel.length}`);
            return;
          }
          client.castVote(auth.player_id, auth.token, focus_item_id, sel);
          toast("Vote envoyé");
        }}
      />
    </div>
  );
}
EOF

# --- Master setup components (simple) ---
cat > src/components/master/setup/ImportSection.tsx <<'EOF'
import React, { useRef } from "react";
import { useDraftStore } from "../../../store/draftStore";
import FilesTable from "./FilesTable";

export default function ImportSection() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const importFiles = useDraftStore(s => s.importFiles);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Import</h2>
      <p style={{ color: "var(--muted)", fontWeight: 700, marginTop: 6 }}>
        Ajoute tes exports Instagram (messages.json).
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 900 }}
          onClick={() => inputRef.current?.click()}
        >
          Ajouter des fichiers
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          multiple
          style={{ display: "none" }}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) await importFiles(files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <FilesTable />
      </div>
    </div>
  );
}
EOF

cat > src/components/master/setup/FilesTable.tsx <<'EOF'
import React from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function FilesTable() {
  const files = useDraftStore(s => s.files);
  const removeFile = useDraftStore(s => s.removeFile);

  if (files.length === 0) {
    return <div style={{ color: "var(--muted)", fontWeight: 700 }}>Aucun fichier importé.</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th align="left">Fichier</th>
          <th align="right">Messages</th>
          <th align="right">Participants</th>
          <th align="right">Erreurs</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "8px 0", fontWeight: 900 }}>{f.name}</td>
            <td align="right">{f.messages_found}</td>
            <td align="right">{f.participants_found}</td>
            <td align="right" style={{ color: f.errors_count ? "var(--warn)" : "var(--muted)", fontWeight: 900 }}>
              {f.errors_count}
            </td>
            <td align="right">
              <button
                style={{ padding: "6px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}
                onClick={() => removeFile(f.id)}
              >
                Retirer
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
EOF

cat > src/components/master/setup/FusionSection.tsx <<'EOF'
import React, { useMemo, useState } from "react";
import { useDraftStore } from "../../../store/draftStore";
import Modal from "../../common/Modal";

export default function FusionSection() {
  const files = useDraftStore(s => s.files);
  const senders = useDraftStore(s => s.senders);

  const [open, setOpen] = useState(false);

  const enabled = files.length >= 2;
  const autoCount = useMemo(() => senders.filter(s => !s.hidden && s.badge === "auto").length, [senders]);
  const manualCount = useMemo(() => senders.filter(s => !s.hidden && s.badge === "manual").length, [senders]);

  return (
    <div style={{ opacity: enabled ? 1 : 0.5 }}>
      <h2 style={{ marginTop: 0 }}>Fusion</h2>
      {!enabled && <div style={{ color: "var(--muted)", fontWeight: 800 }}>Ajoute au moins 2 fichiers pour fusionner.</div>}
      {enabled && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800 }}>{autoCount} fusions automatiques</div>
            <div style={{ color: "var(--muted)", fontWeight: 800 }}>{manualCount} fusions manuelles</div>
          </div>
          <button
            style={{ marginTop: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 900 }}
            onClick={() => setOpen(true)}
          >
            Ouvrir la fusion
          </button>

          <Modal open={open} title="Fusion des senders" onClose={() => setOpen(false)}>
            <div style={{ color: "var(--muted)", fontWeight: 700 }}>
              Modale complète (fusion manuelle + défusion auto) à brancher après.
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
EOF

cat > src/components/master/setup/ActivationSection.tsx <<'EOF'
import React, { useMemo } from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function ActivationSection() {
  const files = useDraftStore(s => s.files);
  const senders = useDraftStore(s => s.senders);
  const toggle = useDraftStore(s => s.toggleSenderActive);
  const rename = useDraftStore(s => s.renameSender);

  const enabled = files.length > 0;

  const list = useMemo(() => {
    return senders
      .filter(s => !s.hidden)
      .slice()
      .sort((a,b)=>b.reel_count_total - a.reel_count_total);
  }, [senders]);

  return (
    <div style={{ opacity: enabled ? 1 : 0.5 }}>
      <h2 style={{ marginTop: 0 }}>Activation</h2>
      {!enabled && <div style={{ color: "var(--muted)", fontWeight: 800 }}>Importe au moins 1 fichier.</div>}

      {enabled && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {list.map((s) => {
            const disabled = s.reel_count_total === 0;
            return (
              <div
                key={s.sender_id_local}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.03)",
                  opacity: disabled ? 0.55 : 1
                }}
              >
                <input
                  type="checkbox"
                  checked={s.active && !disabled}
                  disabled={disabled}
                  onChange={() => toggle(s.sender_id_local)}
                />
                <div style={{ minWidth: 0 }}>
                  <input
                    value={s.display_name}
                    onChange={(e) => rename(s.sender_id_local, e.target.value)}
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--text)",
                      padding: "8px 10px",
                      fontWeight: 900
                    }}
                  />
                  <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 4 }}>
                    a envoyé {s.reel_count_total} reels
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {s.badge !== "none" && (
                    <span style={{
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.04)",
                      fontWeight: 900
                    }}>
                      {s.badge === "auto" ? "Fusion Auto" : "Fusion Manuelle"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
EOF

cat > src/components/master/setup/StatsPanel.tsx <<'EOF'
import React from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function StatsPanel() {
  const s = useDraftStore(st => st.stats);

  const row = (k: string, v: any) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ color: "var(--muted)", fontWeight: 900 }}>{k}</div>
      <div style={{ fontWeight: 900 }}>{v ?? "—"}</div>
    </div>
  );

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <h3 style={{ marginTop: 0 }}>Stats</h3>
      {row("Senders actifs", s.active_senders)}
      {row("ReelItems", s.reel_items)}
      {row("Rounds max", s.rounds_max)}
      {row("Rounds complets", s.rounds_complete)}
      {row("Senders dédoublonnés", s.dedup_senders)}
      {row("Rejets", s.rejected_total)}
    </div>
  );
}
EOF

cat > src/components/master/setup/StickyPrimaryButton.tsx <<'EOF'
import React from "react";

export default function StickyPrimaryButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end", paddingTop: 6 }}>
      <button
        disabled={disabled}
        onClick={onClick}
        style={{
          padding: "12px 16px",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.10)",
          color: "var(--text)",
          fontWeight: 900,
          opacity: disabled ? 0.6 : 1
        }}
      >
        {label}
      </button>
    </div>
  );
}
EOF

# --- Master lobby components ---
cat > src/components/master/lobby/JoinCodePanel.tsx <<'EOF'
import React from "react";
import QRCode from "../../common/QRCode";

export default function JoinCodePanel({ joinCode }: { joinCode: string }) {
  const playUrl = `${window.location.origin}/play`;

  return (
    <div style={{ flex: 1, minWidth: 280, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)", display: "flex", gap: 14, alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: "var(--muted)", fontWeight: 900 }}>Code</div>
        <div style={{ fontSize: 34, fontWeight: 1000, letterSpacing: 3 }}>{joinCode}</div>
        <button
          style={{ marginTop: 8, padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 900 }}
          onClick={() => navigator.clipboard.writeText(joinCode)}
        >
          Copier
        </button>
        <div style={{ marginTop: 10, color: "var(--muted)", fontWeight: 800 }}>
          Ouvre {playUrl} sur mobile.
        </div>
      </div>
      <div>
        <QRCode value={playUrl} />
      </div>
    </div>
  );
}
EOF

cat > src/components/master/lobby/PlayersGrid.tsx <<'EOF'
import React from "react";
import { LobbyPlayer } from "../../../store/lobbyStore";
import PlayerCard from "./PlayerCard";

export default function PlayersGrid({
  players,
  onCreate,
  onDelete,
  onToggleActive
}: {
  players: LobbyPlayer[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Players</h2>
        <button
          style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 900 }}
          onClick={onCreate}
        >
          Créer un player
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {players.map((p) => (
          <PlayerCard key={p.id} p={p} onDelete={onDelete} onToggleActive={onToggleActive} />
        ))}
      </div>
    </div>
  );
}
EOF

cat > src/components/master/lobby/PlayerCard.tsx <<'EOF'
import React from "react";
import Avatar from "../../common/Avatar";
import { LobbyPlayer } from "../../../store/lobbyStore";

function badgeColor(status: LobbyPlayer["status"]) {
  if (status === "connected") return "var(--ok)";
  if (status === "afk") return "var(--warn)";
  if (status === "disabled") return "var(--danger)";
  return "rgba(241,241,247,0.55)";
}

export default function PlayerCard({
  p,
  onDelete,
  onToggleActive
}: {
  p: LobbyPlayer;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.03)", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Avatar src={p.photo_url} size={46} label={p.name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 1000, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: badgeColor(p.status) }} />
            <span style={{ color: "var(--muted)", fontWeight: 900 }}>{p.status.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        {p.type === "sender_linked" ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
            <input
              type="checkbox"
              checked={p.active && p.status !== "disabled"}
              onChange={(e) => onToggleActive(p.id, e.target.checked)}
            />
            Actif
          </label>
        ) : (
          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Manuel</div>
        )}

        {p.type === "manual" && (
          <button
            style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontWeight: 900 }}
            onClick={() => onDelete(p.id)}
          >
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
EOF

cat > src/components/master/lobby/StartGameBar.tsx <<'EOF'
import React from "react";

export default function StartGameBar({
  ready,
  onBackSetup,
  onStart
}: {
  ready: boolean;
  onBackSetup: () => void;
  onStart: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
      <button
        style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", color: "var(--text)", fontWeight: 900 }}
        onClick={onBackSetup}
      >
        Retour Setup
      </button>
      <button
        disabled={!ready}
        style={{
          padding: "12px 16px",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: ready ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
          color: "var(--text)",
          fontWeight: 1000,
          opacity: ready ? 1 : 0.6
        }}
        onClick={() => {
          if (!ready) return;
          if (!confirm("Tout devient définitif. Continuer ?")) return;
          onStart();
        }}
      >
        Start game
      </button>
    </div>
  );
}
EOF

# --- Master game components (minimal render) ---
cat > src/components/master/game/ReelsPanel.tsx <<'EOF'
import React, { useMemo } from "react";
import { useGameStore } from "../../../store/gameStore";

export default function ReelsPanel({ onOpen }: { onOpen: (item_id: string, url?: string | null) => void }) {
  const items = useGameStore(s => s.items);
  const focus = useGameStore(s => s.focus_item_id);
  const reel_urls = useGameStore(s => s.reel_urls_by_item);

  const focusItem = useMemo(() => items.find(i => i.id === focus) || null, [items, focus]);
  const others = useMemo(() => items.filter(i => i.id !== focus), [items, focus]);

  const tile = (it: any, big: boolean) => (
    <div
      key={it.id}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "rgba(255,255,255,0.03)",
        padding: 10,
        display: "grid",
        gap: 10
      }}
    >
      <div style={{ aspectRatio: "1 / 1", borderRadius: 14, border: "1px dashed rgba(241,241,247,0.25)", display: "grid", placeItems: "center" }}>
        <button
          style={{ padding: big ? "12px 14px" : "8px 10px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 1000 }}
          onClick={() => onOpen(it.id, reel_urls ? reel_urls[it.id] : null)}
        >
          Ouvrir
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: it.k }).map((_, idx) => (
          <div key={idx} style={{ width: 18, height: 18, borderRadius: 999, border: "2px dashed rgba(241,241,247,0.35)" }} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <h2 style={{ marginTop: 0 }}>Round</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, alignItems: "start" }}>
        <div>{focusItem ? tile(focusItem, true) : <div style={{ color: "var(--muted)", fontWeight: 900 }}>—</div>}</div>
        <div style={{ display: "grid", gap: 10 }}>
          {others.slice(0, 8).map((it) => tile(it, false))}
        </div>
      </div>
    </div>
  );
}
EOF

cat > src/components/master/game/RemainingSendersBar.tsx <<'EOF'
import React from "react";
import { useGameStore } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function RemainingSendersBar() {
  const remaining = useGameStore(s => s.remaining_sender_ids);
  const senders = useGameStore(s => s.senders);

  const list = remaining.map(id => senders.find(s => s.id === id)).filter(Boolean) as any[];

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Senders restants</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {list.map((s) => (
          <div key={s.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <Avatar src={s.photo_url} size={44} label={s.name} />
            <div style={{ fontSize: 12, fontWeight: 900, maxWidth: 92, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.name}
            </div>
          </div>
        ))}
        {list.length === 0 && <div style={{ color: "var(--muted)", fontWeight: 800 }}>—</div>}
      </div>
    </div>
  );
}
EOF

cat > src/components/master/game/PlayersBar.tsx <<'EOF'
import React from "react";
import { useGameStore } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function PlayersBar() {
  const players = useGameStore(s => s.players);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Players</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {players.filter(p => p.active).map((p) => (
          <div key={p.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <Avatar src={p.photo_url} size={50} label={p.name} />
            <div style={{ fontSize: 12, fontWeight: 900, maxWidth: 110, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
EOF

cat > src/components/master/game/Leaderboard.tsx <<'EOF'
import React from "react";
import { useGameStore } from "../../../store/gameStore";

export default function Leaderboard() {
  const players = useGameStore(s => s.players);

  const list = players.filter(p => p.active).slice().sort((a,b)=>b.score-a.score);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Leaderboard</div>
      <div style={{ display: "grid", gap: 6 }}>
        {list.map((p, idx) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontWeight: 900 }}>{idx+1}. {p.name}</div>
            <div style={{ fontWeight: 1000 }}>{p.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
EOF

cat > src/components/master/game/TimerButton.tsx <<'EOF'
import React, { useMemo } from "react";
import { useGameStore } from "../../../store/gameStore";

export default function TimerButton({ onStart }: { onStart: (item_id: string) => void }) {
  const focus = useGameStore(s => s.focus_item_id);
  const phase = useGameStore(s => s.room?.phase);

  const enabled = useMemo(() => !!focus && (phase === "VOTING" || phase === "TIMER_RUNNING" || phase === "OPEN_REEL"), [focus, phase]);

  return (
    <button
      disabled={!enabled}
      onClick={() => focus && onStart(focus)}
      style={{
        padding: "12px 14px",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: enabled ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
        color: "var(--text)",
        fontWeight: 1000,
        opacity: enabled ? 1 : 0.6
      }}
    >
      Lancer 10s
    </button>
  );
}
EOF

# --- Play components ---
cat > src/components/play/lobby/PlayersList.tsx <<'EOF'
import React from "react";
import { LobbyPlayer } from "../../../ws/lobbyClient";
import Avatar from "../../common/Avatar";

export default function PlayersList({ players, onPick }: { players: LobbyPlayer[]; onPick: (p: LobbyPlayer) => void }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {players.map((p) => {
        const disabled = p.status !== "free";
        return (
          <button
            key={p.id}
            disabled={disabled}
            onClick={() => onPick(p)}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text)",
              opacity: disabled ? 0.55 : 1
            }}
          >
            <Avatar src={p.photo_url} size={44} label={p.name} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontWeight: 1000 }}>{p.name}</div>
              <div style={{ color: "var(--muted)", fontWeight: 900 }}>{p.status}</div>
            </div>
            <div style={{ fontWeight: 1000 }}>{disabled ? "Pris" : "Choisir"}</div>
          </button>
        );
      })}
    </div>
  );
}
EOF

cat > src/components/play/game/VoteGrid.tsx <<'EOF'
import React from "react";
import { GameSender } from "../../../store/gameStore";
import SenderTile from "./SenderTile";

export default function VoteGrid({
  senders,
  selected,
  onToggle
}: {
  senders: GameSender[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
      {senders.map((s) => (
        <SenderTile key={s.id} sender={s} selected={selected.includes(s.id)} onClick={() => onToggle(s.id)} />
      ))}
    </div>
  );
}
EOF

cat > src/components/play/game/SenderTile.tsx <<'EOF'
import React from "react";
import { GameSender } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function SenderTile({
  sender,
  selected,
  onClick
}: {
  sender: GameSender;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "grid",
        gap: 8,
        justifyItems: "center",
        padding: "12px 10px",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: selected ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        color: "var(--text)"
      }}
    >
      <Avatar src={sender.photo_url} size={54} label={sender.name} />
      <div style={{ fontWeight: 1000, fontSize: 13, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>
        {sender.name}
      </div>
    </button>
  );
}
EOF

cat > src/components/play/game/VoteFooter.tsx <<'EOF'
import React from "react";

export default function VoteFooter({
  selectedCount,
  k,
  onSubmit
}: {
  selectedCount: number;
  k: number;
  onSubmit: () => void;
}) {
  return (
    <div style={{ marginTop: 12, position: "sticky", bottom: 12 }}>
      <button
        onClick={onSubmit}
        style={{
          width: "100%",
          padding: "14px 14px",
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.10)",
          color: "var(--text)",
          fontWeight: 1100,
          display: "flex",
          justifyContent: "space-between"
        }}
      >
        <span>Voter</span>
        <span>{selectedCount}/{k}</span>
      </button>
    </div>
  );
}
EOF

# Ensure empty placeholder files exist for imports not used yet (optional)
touch \
  src/components/master/setup/FusionModal.tsx \
  src/components/master/setup/SenderRow.tsx \
  src/components/master/game/ReelTile.tsx \
  src/components/master/game/VotePlacard.tsx \
  src/components/master/game/SlotsRow.tsx \
  src/components/play/lobby/CodeForm.tsx

cat > src/components/master/setup/FusionModal.tsx <<'EOF'
export {};
EOF
cat > src/components/master/setup/SenderRow.tsx <<'EOF'
export {};
EOF
cat > src/components/master/game/ReelTile.tsx <<'EOF'
export {};
EOF
cat > src/components/master/game/VotePlacard.tsx <<'EOF'
export {};
EOF
cat > src/components/master/game/SlotsRow.tsx <<'EOF'
export {};
EOF
cat > src/components/play/lobby/CodeForm.tsx <<'EOF'
export {};
EOF

echo "✅ Frontend files written."
echo ""
echo "Next:"
echo "  npm install"
echo "  npm run dev"
echo ""
echo "Notes:"
echo "- This scaffold expects backend endpoints:"
echo "    POST /lobby/open"
echo "    WS /ws/lobby/{join_code}"
echo "    WS /ws/game/{room_code}"
echo "- Some features are placeholders (fusion modal, wait page actions) and will be wired once backend is up."
