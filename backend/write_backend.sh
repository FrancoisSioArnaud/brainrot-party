#!/usr/bin/env bash
set -euo pipefail

# Brainrot Party backend scaffold (Node.js + TypeScript + Fastify + WebSocket + Redis + Prisma)
# Writes a complete backend skeleton into the CURRENT DIRECTORY.
#
# Usage:
#   mkdir -p backend && cd backend
#   chmod +x write_backend.sh
#   ./write_backend.sh
#   npm install
#   cp .env.example .env
#   npm run dev
#
# Requirements:
#   - Node 18+ (Node 20 recommended)
#   - Redis (recommended for lobby/game state)
#   - A Postgres DB (recommended) or SQLite for local dev (configurable below)

ROOT="$(pwd)"

# Safety: do not overwrite an existing project
if [ -e "$ROOT/package.json" ] || [ -d "$ROOT/src" ] || [ -d "$ROOT/node_modules" ]; then
  echo "ERROR: Current directory already looks like a Node project (package.json/src/node_modules found)."
  echo "Run this script in an EMPTY directory (e.g. ./backend)."
  exit 1
fi

mkdir -p \
  src \
  src/http \
  src/ws \
  src/state \
  src/services \
  src/db \
  prisma

cat > package.json <<'EOF'
{
  "name": "brainrot-party-backend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@fastify/websocket": "^10.0.1",
    "@prisma/client": "^5.19.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "ioredis": "^5.4.1",
    "nanoid": "^5.0.7",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "prisma": "^5.19.1",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2"
  }
}
EOF

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
EOF

cat > .gitignore <<'EOF'
node_modules
dist
.env
.prisma
EOF

cat > .env.example <<'EOF'
# Server
PORT=3010
CORS_ORIGIN=*

# Redis (recommended)
REDIS_URL=redis://127.0.0.1:6379

# Prisma DB
# Recommended: Postgres:
# DATABASE_URL=postgresql://user:password@127.0.0.1:5432/brainrotparty?schema=public
#
# Dev quickstart (SQLite):
DATABASE_URL=file:./dev.db
EOF

# -------------------------
# Prisma schema (MVP tables)
# -------------------------
cat > prisma/schema.prisma <<'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Room {
  id                 String   @id @default(cuid())
  roomCode           String   @unique
  seed               String
  status             String   // IN_GAME | GAME_END
  phase              String   // ROUND_INIT | OPEN_REEL | VOTING | TIMER_RUNNING | REVEAL_SEQUENCE | etc
  currentRoundIndex  Int
  currentItemIndex   Int
  timerEndAt         DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  senders            Sender[]
  players            Player[]
  reelItems          ReelItem[]
  rounds             Round[]
  votes              Vote[]
}

model Sender {
  id        String  @id @default(cuid())
  roomId    String
  room      Room    @relation(fields: [roomId], references: [id])
  name      String
  photoUrl  String?
  color     String
  active    Boolean @default(true)

  reelLinks ReelItemSender[]
  links     PlayerSenderLink[]
  truths    RoundItemTruth[]
  votes     Vote[]
}

model Player {
  id        String  @id @default(cuid())
  roomId    String
  room      Room    @relation(fields: [roomId], references: [id])
  name      String
  photoUrl  String?
  active    Boolean @default(true)
  score     Int     @default(0)

  link      PlayerSenderLink?
  votes     Vote[]
}

model PlayerSenderLink {
  id        String  @id @default(cuid())
  roomId    String
  room      Room    @relation(fields: [roomId], references: [id])
  playerId  String  @unique
  player    Player  @relation(fields: [playerId], references: [id])
  senderId  String?
  sender    Sender? @relation(fields: [senderId], references: [id])
}

model ReelItem {
  id      String @id @default(cuid())
  roomId  String
  room    Room   @relation(fields: [roomId], references: [id])
  url     String

  senders ReelItemSender[]
  items   RoundItem[]
}

model ReelItemSender {
  id        String  @id @default(cuid())
  reelItemId String
  reelItem  ReelItem @relation(fields: [reelItemId], references: [id])
  senderId  String
  sender    Sender  @relation(fields: [senderId], references: [id])

  @@unique([reelItemId, senderId])
}

model Round {
  id      String @id @default(cuid())
  roomId  String
  room    Room   @relation(fields: [roomId], references: [id])
  index   Int

  items   RoundItem[]
}

model RoundItem {
  id         String   @id @default(cuid())
  roundId    String
  round      Round    @relation(fields: [roundId], references: [id])
  reelItemId String
  reelItem   ReelItem @relation(fields: [reelItemId], references: [id])
  orderIndex Int
  k          Int
  opened     Boolean  @default(false)
  resolved   Boolean  @default(false)

  truths     RoundItemTruth[]
  votes      Vote[]
}

model RoundItemTruth {
  id         String   @id @default(cuid())
  roundItemId String
  roundItem  RoundItem @relation(fields: [roundItemId], references: [id])
  senderId   String
  sender     Sender    @relation(fields: [senderId], references: [id])

  @@unique([roundItemId, senderId])
}

model Vote {
  id         String   @id @default(cuid())
  roomId     String
  room       Room     @relation(fields: [roomId], references: [id])
  roundItemId String
  roundItem  RoundItem @relation(fields: [roundItemId], references: [id])
  playerId   String
  player     Player   @relation(fields: [playerId], references: [id])
  senderId   String
  sender     Sender   @relation(fields: [senderId], references: [id])
  createdAt  DateTime @default(now())

  @@index([roomId, roundItemId, playerId])
}
EOF

# --------------
# DB client
# --------------
cat > src/db/prisma.ts <<'EOF'
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
EOF

# --------------
# Config
# --------------
cat > src/config.ts <<'EOF'
import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3010),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  nodeEnv: process.env.NODE_ENV || "development"
};
EOF

# --------------
# Redis client
# --------------
cat > src/state/redis.ts <<'EOF'
import Redis from "ioredis";
import { config } from "../config";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2
});
EOF

# --------------
# IDs / join code helpers
# --------------
cat > src/utils.ts <<'EOF'
import { nanoid } from "nanoid";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const DIGITS = "0123456789";

export function makeJoinCode(): string {
  const pick = (chars: string, n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${pick(LETTERS, 2)}${pick(DIGITS, 2)}${pick(LETTERS, 2)}`;
}

export function makeMasterKey(): string {
  return nanoid(32);
}

export function nowMs(): number {
  return Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
EOF

# -------------------------
# Lobby store (ephemeral)
# -------------------------
cat > src/state/lobbyStore.ts <<'EOF'
import { redis } from "./redis";
import { makeJoinCode, makeMasterKey } from "../utils";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: "free" | "connected" | "afk" | "disabled";
  device_id: string | null;
  player_session_token: string | null;
  photo_url: string | null;
  last_ping_ms: number | null;
};

export type LobbyState = {
  lobby_id: string;
  join_code: string;
  master_key: string;
  local_room_id: string;
  created_at_ms: number;
  // minimal draft snapshot from master
  senders: Array<{ id_local: string; name: string; active: boolean }>;
  players: LobbyPlayer[];
};

const KEY = (join: string) => `brp:lobby:${join}`;

// TTL: lobby expires if abandoned
const LOBBY_TTL_SECONDS = 60 * 60; // 1h (adjust)

export async function createLobby(local_room_id: string): Promise<{ join_code: string; master_key: string }> {
  // regen until unique join_code
  for (let i = 0; i < 20; i++) {
    const join_code = makeJoinCode();
    const exists = await redis.exists(KEY(join_code));
    if (exists) continue;

    const master_key = makeMasterKey();
    const state: LobbyState = {
      lobby_id: `lobby_${join_code}`,
      join_code,
      master_key,
      local_room_id,
      created_at_ms: Date.now(),
      senders: [],
      players: []
    };
    await redis.set(KEY(join_code), JSON.stringify(state), "EX", LOBBY_TTL_SECONDS);
    return { join_code, master_key };
  }
  throw new Error("failed_to_create_lobby");
}

export async function getLobby(join_code: string): Promise<LobbyState | null> {
  const raw = await redis.get(KEY(join_code));
  if (!raw) return null;
  try { return JSON.parse(raw) as LobbyState; } catch { return null; }
}

export async function saveLobby(state: LobbyState): Promise<void> {
  await redis.set(KEY(state.join_code), JSON.stringify(state), "EX", LOBBY_TTL_SECONDS);
}

export async function deleteLobby(join_code: string): Promise<void> {
  await redis.del(KEY(join_code));
}
EOF

# -------------------------
# Game store (ephemeral)
# -------------------------
cat > src/state/gameStore.ts <<'EOF'
import { redis } from "./redis";

export type GameState = {
  room_code: string;
  master_key: string;
  // minimal; expanded in later steps
  phase: string;
  timer_end_ts: number | null;
};

const KEY = (room: string) => `brp:game:${room}`;
const TTL_SECONDS = 60 * 60 * 6;

export async function getGame(room_code: string): Promise<GameState | null> {
  const raw = await redis.get(KEY(room_code));
  if (!raw) return null;
  try { return JSON.parse(raw) as GameState; } catch { return null; }
}

export async function saveGame(state: GameState): Promise<void> {
  await redis.set(KEY(state.room_code), JSON.stringify(state), "EX", TTL_SECONDS);
}
EOF

# -------------------------
# HTTP routes
# -------------------------
cat > src/http/routes.ts <<'EOF'
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLobby } from "../state/lobbyStore";

export async function registerHttpRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  // Front expects: POST /lobby/open -> {join_code, master_key}
  app.post("/lobby/open", async (req, reply) => {
    const bodySchema = z.object({
      local_room_id: z.string().optional()
    });
    const body = bodySchema.safeParse((req as any).body ?? {});
    const local_room_id = body.success && body.data.local_room_id ? body.data.local_room_id : `local_${Date.now()}`;

    const out = await createLobby(local_room_id);
    return reply.send(out);
  });

  // Photo upload endpoints will be added later:
  // POST /lobby/:joinCode/players/:playerId/photo
}
EOF

# -------------------------
# WS protocol helpers
# -------------------------
cat > src/ws/protocol.ts <<'EOF'
export type WSMsg = {
  type: string;
  req_id?: string;
  ts?: number;
  payload?: any;
};

export function ack(req_id: string | undefined, payload: any = {}) {
  return { type: "ack", req_id, ts: Date.now(), payload };
}

export function err(req_id: string | undefined, code: string, message: string, extra?: any) {
  return { type: "error", req_id, ts: Date.now(), payload: { code, message, ...extra } };
}
EOF

# -------------------------
# WS Lobby handler (skeleton)
# -------------------------
cat > src/ws/lobbyWs.ts <<'EOF'
import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { ack, err, WSMsg } from "./protocol";
import { getLobby, saveLobby, LobbyState, LobbyPlayer } from "../state/lobbyStore";

type Conn = { ws: WebSocket; role: "master" | "play"; device_id?: string };

const lobbyConnections = new Map<string, Set<Conn>>(); // join_code -> conns

function broadcast(join_code: string, msg: any) {
  const conns = lobbyConnections.get(join_code);
  if (!conns) return;
  for (const c of conns) {
    try { c.ws.send(JSON.stringify(msg)); } catch {}
  }
}

function send(ws: WebSocket, msg: any) {
  ws.send(JSON.stringify(msg));
}

function upsertConn(join_code: string, conn: Conn) {
  const set = lobbyConnections.get(join_code) || new Set<Conn>();
  set.add(conn);
  lobbyConnections.set(join_code, set);
}

function removeConn(join_code: string, conn: Conn) {
  const set = lobbyConnections.get(join_code);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) lobbyConnections.delete(join_code);
}

function lobbyStatePayload(state: LobbyState) {
  return {
    join_code: state.join_code,
    players: state.players.map(p => ({
      id: p.id,
      type: p.type,
      sender_id_local: p.sender_id_local,
      active: p.active,
      name: p.name,
      status: p.status,
      photo_url: p.photo_url
    })),
    senders: state.senders
  };
}

export async function registerLobbyWS(app: FastifyInstance) {
  app.get("/ws/lobby/:joinCode", { websocket: true }, async (conn, req) => {
    const join_code = String((req.params as any).joinCode || "");
    const role = (String((req.query as any).role || "play") as "master" | "play");
    const c: Conn = { ws: conn.socket, role };

    upsertConn(join_code, c);

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg) return;

      const state = await getLobby(join_code);
      if (!state) {
        send(conn.socket, err(msg.req_id, "LOBBY_NOT_FOUND", "Lobby introuvable"));
        return;
      }

      switch (msg.type) {
        case "master_hello": {
          const { master_key } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          send(conn.socket, ack(msg.req_id, { ok: true }));
          send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "sync_from_draft": {
          const { master_key, draft } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          // draft shape expected minimal:
          // { local_room_id, senders_active: [{id_local,name,active}], players?: [] }
          state.local_room_id = draft?.local_room_id || state.local_room_id;
          state.senders = Array.isArray(draft?.senders_active) ? draft.senders_active : state.senders;

          // auto-create sender-linked players if missing
          const existingBySender = new Map<string, LobbyPlayer>();
          for (const p of state.players) if (p.sender_id_local) existingBySender.set(p.sender_id_local, p);

          for (const s of state.senders.filter((x: any) => x.active)) {
            if (!existingBySender.has(s.id_local)) {
              state.players.push({
                id: `p_${crypto.randomUUID()}`,
                type: "sender_linked",
                sender_id_local: s.id_local,
                active: true,
                name: s.name,
                status: "free",
                device_id: null,
                player_session_token: null,
                photo_url: null,
                last_ping_ms: null
              });
            } else {
              // keep name in sync (until start game)
              const p = existingBySender.get(s.id_local)!;
              p.name = s.name;
              p.active = true;
              if (p.status === "disabled") p.status = "free";
            }
          }

          // disable players whose senders are inactive (kick later)
          const activeSenderSet = new Set(state.senders.filter((x: any) => x.active).map((x: any) => x.id_local));
          for (const p of state.players) {
            if (p.type === "sender_linked" && p.sender_id_local && !activeSenderSet.has(p.sender_id_local)) {
              p.active = false;
              p.status = "disabled";
              p.device_id = null;
              p.player_session_token = null;
            }
          }

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "play_hello": {
          const { device_id } = msg.payload || {};
          c.device_id = device_id;
          send(conn.socket, ack(msg.req_id, { ok: true }));
          send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "create_manual_player": {
          const { master_key, name } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          state.players.push({
            id: `p_${crypto.randomUUID()}`,
            type: "manual",
            sender_id_local: null,
            active: true,
            name: String(name || "Player"),
            status: "free",
            device_id: null,
            player_session_token: null,
            photo_url: null,
            last_ping_ms: null
          });
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "delete_player": {
          const { master_key, player_id } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          // Only manual deletable (spec)
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.type !== "manual") {
            send(conn.socket, err(msg.req_id, "NOT_ALLOWED", "Impossible de supprimer un player lié à un sender"));
            return;
          }
          // kick immediate (broadcast event)
          broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { player_id, message: "Player supprimé" } });
          state.players = state.players.filter(x => x.id !== player_id);
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "set_player_active": {
          const { master_key, player_id, active } = msg.payload || {};
          if (master_key !== state.master_key) {
            send(conn.socket, err(msg.req_id, "MASTER_KEY_INVALID", "Master key invalide"));
            return;
          }
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }

          // spec: sender-linked can be disabled; manual cannot be disabled separately
          if (p.type === "manual") {
            send(conn.socket, err(msg.req_id, "NOT_ALLOWED", "Les players manuels ne se désactivent pas (supprime-le)"));
            return;
          }

          p.active = Boolean(active);
          if (!p.active) {
            p.status = "disabled";
            p.device_id = null;
            p.player_session_token = null;
            broadcast(join_code, { type: "player_kicked", ts: Date.now(), payload: { player_id, message: "Player désactivé" } });
          } else {
            p.status = "free";
          }

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "claim_player": {
          const { device_id, player_id } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p || !p.active || p.status === "disabled") {
            send(conn.socket, err(msg.req_id, "NOT_AVAILABLE", "Player indisponible"));
            return;
          }
          if (p.status !== "free") {
            send(conn.socket, err(msg.req_id, "TAKEN", "Player déjà pris"));
            return;
          }
          // reserve atomically (single redis record write is "atomic enough" for MVP, but later we’ll use WATCH)
          p.status = "connected";
          p.device_id = String(device_id || "");
          p.player_session_token = `t_${crypto.randomUUID()}`;
          p.last_ping_ms = Date.now();

          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });

          // Targeted token (MVP: broadcast + device filters on client; later we’ll send only to that ws)
          broadcast(join_code, { type: "player_claimed", ts: Date.now(), payload: { player_id: p.id, device_id: p.device_id, player_session_token: p.player_session_token } });
          return;
        }

        case "release_player": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }
          p.status = "free";
          p.device_id = null;
          p.player_session_token = null;
          p.last_ping_ms = null;
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "ping": {
          const { device_id, player_id, player_session_token } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }
          p.last_ping_ms = Date.now();
          if (p.status === "afk") p.status = "connected";
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          return;
        }

        case "set_player_name": {
          const { device_id, player_id, player_session_token, name } = msg.payload || {};
          const p = state.players.find(x => x.id === player_id);
          if (!p) { send(conn.socket, ack(msg.req_id, { ok: true })); return; }
          if (p.device_id !== device_id || p.player_session_token !== player_session_token) {
            send(conn.socket, err(msg.req_id, "TOKEN_INVALID", "Token invalide"));
            return;
          }
          p.name = String(name || p.name).slice(0, 48);
          await saveLobby(state);
          send(conn.socket, ack(msg.req_id, { ok: true }));
          broadcast(join_code, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
          return;
        }

        case "start_game_request": {
          // Full implementation in next backend step (persist + rounds + open game WS).
          // For now: placeholder error.
          send(conn.socket, err(msg.req_id, "NOT_IMPLEMENTED", "Start game pas encore implémenté"));
          return;
        }

        default:
          send(conn.socket, err(msg.req_id, "UNKNOWN", "Message inconnu"));
          return;
      }
    });

    conn.socket.on("close", () => {
      removeConn(join_code, c);
    });

    // immediate state push if exists
    const state = await getLobby(join_code);
    if (state) {
      send(conn.socket, { type: "lobby_state", ts: Date.now(), payload: lobbyStatePayload(state) });
    } else {
      send(conn.socket, { type: "error", ts: Date.now(), payload: { code: "LOBBY_NOT_FOUND", message: "Lobby introuvable" } });
    }
  });
}
EOF

# -------------------------
# WS Game handler (placeholder)
# -------------------------
cat > src/ws/gameWs.ts <<'EOF'
import { FastifyInstance } from "fastify";
import { ack, err, WSMsg } from "./protocol";
import { getGame } from "../state/gameStore";

export async function registerGameWS(app: FastifyInstance) {
  app.get("/ws/game/:roomCode", { websocket: true }, async (conn, req) => {
    const room_code = String((req.params as any).roomCode || "");
    const role = String((req.query as any).role || "play");

    conn.socket.on("message", async (raw) => {
      let msg: WSMsg | null = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg) return;

      // Placeholder: only state_sync if game exists
      if (msg.type === "master_hello" || msg.type === "play_hello") {
        const st = await getGame(room_code);
        if (!st) {
          conn.socket.send(JSON.stringify(err(msg.req_id, "GAME_NOT_FOUND", "Partie introuvable")));
          return;
        }
        conn.socket.send(JSON.stringify(ack(msg.req_id, { ok: true })));
        conn.socket.send(JSON.stringify({ type: "state_sync", ts: Date.now(), payload: st }));
        return;
      }

      conn.socket.send(JSON.stringify(err(msg.req_id, "NOT_IMPLEMENTED", "Game WS pas encore implémenté")));
    });
  });
}
EOF

# -------------------------
# Server entry
# -------------------------
cat > src/index.ts <<'EOF'
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config";
import { registerHttpRoutes } from "./http/routes";
import { registerLobbyWS } from "./ws/lobbyWs";
import { registerGameWS } from "./ws/gameWs";

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin });
await app.register(websocket);

await registerHttpRoutes(app);
await registerLobbyWS(app);
await registerGameWS(app);

app.listen({ port: config.port, host: "0.0.0.0" }).then(() => {
  app.log.info(`brainrot-party-backend listening on :${config.port}`);
});
EOF

# -------------------------
# README quickstart
# -------------------------
cat > README.md <<'EOF'
# Brainrot Party Backend (scaffold)

## Run (dev)
```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
