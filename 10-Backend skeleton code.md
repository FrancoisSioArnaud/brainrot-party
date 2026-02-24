```ts
// src/config.ts
export const CONFIG = {
  PORT: Number(process.env.PORT ?? 3010),
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  ROOM_TTL_SECONDS: 12 * 60 * 60, // 43200
  MAX_AVATAR_DATAURL_CHARS: Number(process.env.MAX_AVATAR_DATAURL_CHARS ?? 200_000),
};
```

```ts
// src/utils/time.ts
export function nowMs(): number {
  return Date.now();
}
```

```ts
// src/utils/hash.ts
import crypto from "node:crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function sha256Tagged(input: string): string {
  return `sha256:${sha256Hex(input)}`;
}
```

```ts
// src/utils/ids.ts
import crypto from "node:crypto";

export function genMasterKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function genRoomCode(): string {
  // 8 chars, uppercase+digits excluding confusing ones
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
```

```ts
// src/utils/json.ts
export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function jsonStringifyStable(obj: unknown): string {
  return JSON.stringify(obj);
}
```

```ts
// src/ws/messages.ts
// Copy of ws/messages.ts — v3 (backend-side). Keep in sync with frontend.

export type RoomCode = string;
export type DeviceId = string;
export type MasterKey = string;

export type PlayerId = string;
export type SenderId = string;
export type RoundId = string;
export type ItemId = string;
export type ReelId = string;

export type Phase = "lobby" | "game" | "over";
export type PlayerStatus = "free" | "taken";
export type GameStatus = "idle" | "vote" | "reveal_wait" | "round_recap";

export interface PlayerVisible {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;
  active: true;
  status: PlayerStatus;
  name: string;
  avatar_url: string | null; // dataURL in MVP
}

export interface PlayerAll {
  player_id: PlayerId;
  sender_id: SenderId;
  is_sender_bound: boolean;
  active: boolean;
  name: string;
  avatar_url: string | null;
}

export interface SenderVisible {
  sender_id: SenderId;
  name: string;
  active: true;
  reels_count: number;
}

export interface SenderAll {
  sender_id: SenderId;
  name: string;
  active: boolean;
  reels_count: number;
}

export interface SenderSelectable {
  sender_id: SenderId;
  name: string;
}

export interface ReelPublic {
  reel_id: ReelId;
  url: string;
}

export interface WsEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

export type ErrorCode =
  | "room_not_found"
  | "room_expired"
  | "bad_request"
  | "forbidden"
  | "conflict"
  | "not_in_phase"
  | "not_claimed";

export interface ErrorRes {
  code?: RoomCode;
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}
export type ErrorMsg = WsEnvelope<"ERROR", ErrorRes>;

/* Requests */

export interface CreateRoomReq {
  senders: Array<{
    sender_id: SenderId;
    name: string;
    active: boolean;
    reels_count: number;
  }>;
  rounds: Array<{
    round_id: RoundId;
    items: Array<{
      item_id: ItemId;
      reel: { reel_id: ReelId; url: string };
      true_sender_ids: SenderId[];
    }>;
  }>;
  round_order?: RoundId[];
}
export type CreateRoomMsg = WsEnvelope<"CREATE_ROOM", CreateRoomReq>;

export interface JoinRoomReq {
  code: RoomCode;
  device_id: DeviceId;
}
export type JoinRoomMsg = WsEnvelope<"JOIN_ROOM", JoinRoomReq>;

export interface TakePlayerReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
}
export type TakePlayerMsg = WsEnvelope<"TAKE_PLAYER", TakePlayerReq>;

export interface RenamePlayerReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
  new_name: string;
}
export type RenamePlayerMsg = WsEnvelope<"RENAME_PLAYER", RenamePlayerReq>;

export interface UpdateAvatarReq {
  code: RoomCode;
  player_id: PlayerId;
  device_id: DeviceId;
  image: string; // dataURL jpeg 300x300
}
export type UpdateAvatarMsg = WsEnvelope<"UPDATE_AVATAR", UpdateAvatarReq>;

export interface TogglePlayerReq {
  code: RoomCode;
  master_key: MasterKey;
  player_id: PlayerId;
  active: boolean;
}
export type TogglePlayerMsg = WsEnvelope<"TOGGLE_PLAYER", TogglePlayerReq>;

export interface StartGameReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type StartGameMsg = WsEnvelope<"START_GAME", StartGameReq>;

export interface ReelOpenedReq {
  code: RoomCode;
  master_key: MasterKey;
  round_id: RoundId;
  item_id: ItemId;
}
export type ReelOpenedMsg = WsEnvelope<"REEL_OPENED", ReelOpenedReq>;

export interface SubmitVoteReq {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  player_id: PlayerId;
  device_id: DeviceId;
  selections: SenderId[];
}
export type SubmitVoteMsg = WsEnvelope<"SUBMIT_VOTE", SubmitVoteReq>;

export interface EndItemReq {
  code: RoomCode;
  master_key: MasterKey;
  round_id: RoundId;
  item_id: ItemId;
}
export type EndItemMsg = WsEnvelope<"END_ITEM", EndItemReq>;

export interface StartNextRoundReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type StartNextRoundMsg = WsEnvelope<"START_NEXT_ROUND", StartNextRoundReq>;

export interface StateSyncReq {
  code: RoomCode;
  device_id: DeviceId;
  master_key?: MasterKey;
}
export type StateSyncMsg = WsEnvelope<"STATE_SYNC", StateSyncReq>;

export interface RoomClosedReq {
  code: RoomCode;
  master_key: MasterKey;
}
export type RoomClosedMsg = WsEnvelope<"ROOM_CLOSED", RoomClosedReq>;

/* Server pushes */

export interface RoomCreatedRes {
  code: RoomCode;
  master_key: MasterKey;
  phase: Phase;
  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];
}
export type RoomCreatedMsg = WsEnvelope<"ROOM_CREATED", RoomCreatedRes>;

export interface JoinOkRes {
  code: RoomCode;
  phase: Phase;
  players_visible: PlayerVisible[];
}
export type JoinOkMsg = WsEnvelope<"JOIN_OK", JoinOkRes>;

export interface TakePlayerOkRes {
  code: RoomCode;
  player_id: PlayerId;
}
export type TakePlayerOkMsg = WsEnvelope<"TAKE_PLAYER_OK", TakePlayerOkRes>;

export interface TakePlayerFailRes {
  code: RoomCode;
  player_id: PlayerId;
  reason: "taken_now" | "disabled" | "inactive" | "device_already_has_player";
}
export type TakePlayerFailMsg = WsEnvelope<"TAKE_PLAYER_FAIL", TakePlayerFailRes>;

export interface PlayerUpdateRes {
  code: RoomCode;
  player: PlayerVisible;
  sender_updated?: SenderVisible;
}
export type PlayerUpdateMsg = WsEnvelope<"PLAYER_UPDATE", PlayerUpdateRes>;

export interface SlotInvalidatedRes {
  code: RoomCode;
  player_id: PlayerId;
  reason: "disabled_or_deleted";
}
export type SlotInvalidatedMsg = WsEnvelope<"SLOT_INVALIDATED", SlotInvalidatedRes>;

export interface GameStartRes {
  code: RoomCode;
}
export type GameStartMsg = WsEnvelope<"GAME_START", GameStartRes>;

export interface NewItemRes {
  code: RoomCode;
  round_id: RoundId;
  item_index: number;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  senders_selectable: SenderSelectable[];
  slots_total: number;
}
export type NewItemMsg = WsEnvelope<"NEW_ITEM", NewItemRes>;

export interface StartVoteRes {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  k: number;
  senders_selectable: SenderSelectable[];
}
export type StartVoteMsg = WsEnvelope<"START_VOTE", StartVoteRes>;

export interface VoteAckRes {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  accepted: boolean;
  reason?:
    | "invalid_selection"
    | "late"
    | "too_many"
    | "not_in_vote"
    | "not_claimed"
    | "not_expected_voter";
}
export type VoteAckMsg = WsEnvelope<"VOTE_ACK", VoteAckRes>;

export interface PlayerVotedRes {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  player_id: PlayerId;
}
export type PlayerVotedMsg = WsEnvelope<"PLAYER_VOTED", PlayerVotedRes>;

export interface VoteResultPerPlayer {
  player_id: PlayerId;
  selections: SenderId[];
  correct: SenderId[];
  incorrect: SenderId[];
  points_gained: number;
  score_total: number;
}

export interface VoteResultsRes {
  code: RoomCode;
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: VoteResultPerPlayer[];
}
export type VoteResultsMsg = WsEnvelope<"VOTE_RESULTS", VoteResultsRes>;

export interface RoundRecapPerPlayer {
  player_id: PlayerId;
  points_round: number;
  score_total: number;
}
export interface RoundRecapRes {
  code: RoomCode;
  round_id: RoundId;
  players: RoundRecapPerPlayer[];
}
export type RoundRecapMsg = WsEnvelope<"ROUND_RECAP", RoundRecapRes>;

export interface RoundFinishedRes {
  code: RoomCode;
  round_id: RoundId;
}
export type RoundFinishedMsg = WsEnvelope<"ROUND_FINISHED", RoundFinishedRes>;

export interface GameStateSyncItem {
  round_id: RoundId;
  item_id: ItemId;
  reel: ReelPublic;
  k: number;
  senders_selectable: SenderSelectable[];
}
export interface GameStateSync {
  current_round_id: RoundId | null;
  current_item_index: number | null;
  status: GameStatus;
  item: GameStateSyncItem | null;
  votes_received_player_ids?: PlayerId[];
  current_vote_results?: Omit<VoteResultsRes, "code">;
}
export interface StateSyncRes {
  code: RoomCode;
  phase: Phase;

  players_visible: PlayerVisible[];
  senders_visible: SenderVisible[];

  players_all?: PlayerAll[];
  senders_all?: SenderAll[];

  my_player_id: PlayerId | null;
  game: GameStateSync | null;

  scores: Record<PlayerId, number>;
}
export type StateSyncResponseMsg = WsEnvelope<"STATE_SYNC_RESPONSE", StateSyncRes>;

export interface RankingEntry {
  player_id: PlayerId;
  score_total: number;
  rank: number;
}
export interface GameOverRes {
  code: RoomCode;
  ranking: RankingEntry[];
  scores: Record<PlayerId, number>;
}
export type GameOverMsg = WsEnvelope<"GAME_OVER", GameOverRes>;

export interface RoomClosedBroadcastRes {
  code: RoomCode;
  reason: "closed_by_master";
}
export type RoomClosedBroadcastMsg = WsEnvelope<"ROOM_CLOSED_BROADCAST", RoomClosedBroadcastRes>;

/* Unions */

export type ClientToServerMsg =
  | CreateRoomMsg
  | JoinRoomMsg
  | TakePlayerMsg
  | RenamePlayerMsg
  | UpdateAvatarMsg
  | TogglePlayerMsg
  | StartGameMsg
  | ReelOpenedMsg
  | SubmitVoteMsg
  | EndItemMsg
  | StartNextRoundMsg
  | StateSyncMsg
  | RoomClosedMsg;

export type ServerToClientMsg =
  | RoomCreatedMsg
  | JoinOkMsg
  | ErrorMsg
  | TakePlayerOkMsg
  | TakePlayerFailMsg
  | PlayerUpdateMsg
  | SlotInvalidatedMsg
  | GameStartMsg
  | NewItemMsg
  | StartVoteMsg
  | VoteAckMsg
  | PlayerVotedMsg
  | VoteResultsMsg
  | RoundRecapMsg
  | RoundFinishedMsg
  | StateSyncResponseMsg
  | GameOverMsg
  | RoomClosedBroadcastMsg;
```

```ts
// src/ws/errors.ts
import type WebSocket from "ws";
import type { ErrorCode, ErrorMsg, RoomCode } from "./messages.js";

export function sendError(
  ws: WebSocket,
  error: ErrorCode,
  opts?: { code?: RoomCode; message?: string; details?: Record<string, unknown> }
) {
  const msg: ErrorMsg = {
    type: "ERROR",
    payload: {
      code: opts?.code,
      error,
      message: opts?.message,
      details: opts?.details,
    },
  };
  ws.send(JSON.stringify(msg));
}
```

```ts
// src/ws/auth.ts
import { sha256Tagged } from "../utils/hash.js";

export function verifyMasterKey(master_key_hash: string, master_key: string): boolean {
  return master_key_hash === sha256Tagged(master_key);
}
```

```ts
// src/ws/validators.ts
import { CONFIG } from "../config.js";
import { safeJsonParse } from "../utils/json.js";
import type { ClientToServerMsg } from "./messages.js";

export function parseClientMsg(raw: string): ClientToServerMsg | null {
  return safeJsonParse<ClientToServerMsg>(raw);
}

export function validateAvatarDataUrl(image: string): { ok: true } | { ok: false; reason: string } {
  if (typeof image !== "string") return { ok: false, reason: "not_string" };
  if (!image.startsWith("data:image/")) return { ok: false, reason: "bad_prefix" };
  if (image.length > CONFIG.MAX_AVATAR_DATAURL_CHARS) return { ok: false, reason: "too_large" };
  return { ok: true };
}
```

```ts
// src/ws/broadcast.ts
import type WebSocket from "ws";
import type { ServerToClientMsg, RoomCode } from "./messages.js";

export type SocketMeta = {
  code?: RoomCode;
  device_id?: string;
  is_master?: boolean;
};

export class Registry {
  private roomToSockets = new Map<RoomCode, Set<WebSocket>>();
  private socketMeta = new Map<WebSocket, SocketMeta>();

  joinRoom(ws: WebSocket, code: RoomCode) {
    const set = this.roomToSockets.get(code) ?? new Set<WebSocket>();
    set.add(ws);
    this.roomToSockets.set(code, set);

    const meta = this.socketMeta.get(ws) ?? {};
    meta.code = code;
    this.socketMeta.set(ws, meta);
  }

  leave(ws: WebSocket) {
    const meta = this.socketMeta.get(ws);
    if (meta?.code) {
      const set = this.roomToSockets.get(meta.code);
      if (set) {
        set.delete(ws);
        if (set.size === 0) this.roomToSockets.delete(meta.code);
      }
    }
    this.socketMeta.delete(ws);
  }

  setMeta(ws: WebSocket, patch: Partial<SocketMeta>) {
    const meta = this.socketMeta.get(ws) ?? {};
    Object.assign(meta, patch);
    this.socketMeta.set(ws, meta);
  }

  getMeta(ws: WebSocket): SocketMeta | undefined {
    return this.socketMeta.get(ws);
  }

  socketsInRoom(code: RoomCode): WebSocket[] {
    return Array.from(this.roomToSockets.get(code) ?? []);
  }

  broadcast(code: RoomCode, msg: ServerToClientMsg) {
    const raw = JSON.stringify(msg);
    for (const ws of this.socketsInRoom(code)) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  send(ws: WebSocket, msg: ServerToClientMsg) {
    ws.send(JSON.stringify(msg));
  }
}
```

```ts
// src/redis/redis.ts
import IORedis from "ioredis";
import { CONFIG } from "../config.js";

export const redis = new IORedis(CONFIG.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});
```

```ts
// src/redis/keys.ts
import type { RoomCode, RoundId, ItemId } from "../ws/messages.js";

export const keys = {
  meta: (code: RoomCode) => `room:${code}:meta`,
  senders: (code: RoomCode) => `room:${code}:senders`,
  players: (code: RoomCode) => `room:${code}:players`,
  game: (code: RoomCode) => `room:${code}:game`,
  claims: (code: RoomCode) => `room:${code}:claims`,
  scores: (code: RoomCode) => `room:${code}:scores`,
  roundDelta: (code: RoomCode, round_id: RoundId) => `room:${code}:round_delta:${round_id}`,
  round: (code: RoomCode, round_id: RoundId) => `room:${code}:round:${round_id}`,
  votes: (code: RoomCode, round_id: RoundId, item_id: ItemId) => `room:${code}:votes:${round_id}:${item_id}`,
  scanPrefix: (code: RoomCode) => `room:${code}:*`,
};
```

```ts
// src/redis/ttl.ts
import { CONFIG } from "../config.js";
import { redis } from "./redis.js";

export async function expireKey(key: string): Promise<void> {
  await redis.expire(key, CONFIG.ROOM_TTL_SECONDS);
}

export async function expireKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const pipe = redis.pipeline();
  for (const k of keys) pipe.expire(k, CONFIG.ROOM_TTL_SECONDS);
  await pipe.exec();
}
```

```lua
-- src/redis/lua/takePlayer.lua
-- KEYS[1] = claims hash key
-- ARGV[1] = player_id
-- ARGV[2] = device_id
--
-- Fail if:
-- - player_id already claimed
-- - device_id already has a claimed player (any field value equals device_id)

local claimsKey = KEYS[1]
local playerId = ARGV[1]
local deviceId = ARGV[2]

-- already claimed?
local existing = redis.call("HGET", claimsKey, playerId)
if existing then
  return {0, "taken_now"}
end

-- device already has a player?
local all = redis.call("HGETALL", claimsKey)
for i = 2, #all, 2 do
  if all[i] == deviceId then
    return {0, "device_already_has_player"}
  end
end

redis.call("HSET", claimsKey, playerId, deviceId)
return {1, "ok"}
```

```ts
// src/redis/roomRepo.ts
import { redis } from "./redis.js";
import { keys } from "./keys.js";
import { expireKeys } from "./ttl.js";
import { jsonStringifyStable, safeJsonParse } from "../utils/json.js";
import type {
  RoomCode,
  RoundId,
  ItemId,
  PlayerId,
  DeviceId,
  SenderId,
  PlayerAll,
  PlayerVisible,
  SenderAll,
  SenderVisible,
} from "../ws/messages.js";
import { sha256Tagged } from "../utils/hash.js";

export type RoomMeta = {
  code: string;
  created_at: number;
  expires_at: number;
  phase: "lobby" | "game" | "over";
  version: number;
  master_key_hash: string;
};

export type VoteValue = { selections: SenderId[]; ts: number };

export type RoomRoundItem = {
  item_id: string;
  reel: { reel_id: string; url: string };
  true_sender_ids: SenderId[];
  k: number;
};
export type RoomRound = { round_id: string; created_at: number; items: RoomRoundItem[] };

export type CurrentVote = { round_id: RoundId; item_id: ItemId; expected_player_ids: PlayerId[] };

export type CurrentVoteResults = {
  round_id: RoundId;
  item_id: ItemId;
  true_senders: SenderId[];
  players: Array<{
    player_id: PlayerId;
    selections: SenderId[];
    correct: SenderId[];
    incorrect: SenderId[];
    points_gained: number;
    score_total: number;
  }>;
};

export type RoomGame = {
  phase: "lobby" | "game";
  round_order: RoundId[];
  current_round_id: RoundId | null;
  current_item_index: number | null;
  status: "idle" | "vote" | "reveal_wait" | "round_recap";
  current_vote: CurrentVote | null;
  votes_received_player_ids: PlayerId[] | null;
  current_vote_results: CurrentVoteResults | null;
  version: number;
};

export class RoomRepo {
  /* Meta */
  async getMeta(code: RoomCode): Promise<RoomMeta | null> {
    const raw = await redis.get(keys.meta(code));
    if (!raw) return null;
    return safeJsonParse<RoomMeta>(raw);
  }

  async setMeta(code: RoomCode, meta: RoomMeta): Promise<void> {
    await redis.set(keys.meta(code), jsonStringifyStable(meta));
  }

  async verifyMasterKey(code: RoomCode, master_key: string): Promise<boolean> {
    const meta = await this.getMeta(code);
    if (!meta) return false;
    return meta.master_key_hash === sha256Tagged(master_key);
  }

  /* Players / Senders */
  async getPlayersAll(code: RoomCode): Promise<PlayerAll[] | null> {
    const raw = await redis.get(keys.players(code));
    if (!raw) return null;
    return safeJsonParse<PlayerAll[]>(raw);
  }

  async setPlayersAll(code: RoomCode, players: PlayerAll[]): Promise<void> {
    await redis.set(keys.players(code), jsonStringifyStable(players));
  }

  async getSendersAll(code: RoomCode): Promise<SenderAll[] | null> {
    const raw = await redis.get(keys.senders(code));
    if (!raw) return null;
    return safeJsonParse<SenderAll[]>(raw);
  }

  async setSendersAll(code: RoomCode, senders: SenderAll[]): Promise<void> {
    await redis.set(keys.senders(code), jsonStringifyStable(senders));
  }

  buildPlayersVisible(playersAll: PlayerAll[], claims: Record<string, string>): PlayerVisible[] {
    return playersAll
      .filter((p) => p.active)
      .map((p) => ({
        player_id: p.player_id,
        sender_id: p.sender_id,
        is_sender_bound: p.is_sender_bound,
        active: true as const,
        status: claims[p.player_id] ? "taken" : "free",
        name: p.name,
        avatar_url: p.avatar_url,
      }));
  }

  buildSendersVisible(sendersAll: SenderAll[]): SenderVisible[] {
    return sendersAll
      .filter((s) => s.active)
      .map((s) => ({
        sender_id: s.sender_id,
        name: s.name,
        active: true as const,
        reels_count: s.reels_count,
      }));
  }

  /* Claims */
  async getClaims(code: RoomCode): Promise<Record<string, string>> {
    return await redis.hgetall(keys.claims(code));
  }

  async getClaim(code: RoomCode, player_id: PlayerId): Promise<DeviceId | null> {
    const v = await redis.hget(keys.claims(code), player_id);
    return v ?? null;
  }

  async releaseClaim(code: RoomCode, player_id: PlayerId): Promise<void> {
    await redis.hdel(keys.claims(code), player_id);
  }

  /* Scores */
  async getScores(code: RoomCode): Promise<Record<string, number>> {
    const raw = await redis.hgetall(keys.scores(code));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = Number(v);
    return out;
  }

  async incrScore(code: RoomCode, player_id: PlayerId, delta: number): Promise<number> {
    return await redis.hincrby(keys.scores(code), player_id, delta);
  }

  /* Round delta */
  async getRoundDelta(code: RoomCode, round_id: RoundId): Promise<Record<string, number>> {
    const raw = await redis.hgetall(keys.roundDelta(code, round_id));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = Number(v);
    return out;
  }

  async initRoundDelta(code: RoomCode, round_id: RoundId, playerIds: PlayerId[]): Promise<void> {
    const h: Record<string, string> = {};
    for (const pid of playerIds) h[pid] = "0";
    if (Object.keys(h).length === 0) return;
    await redis.hset(keys.roundDelta(code, round_id), h);
  }

  async incrRoundDelta(code: RoomCode, round_id: RoundId, player_id: PlayerId, delta: number): Promise<number> {
    return await redis.hincrby(keys.roundDelta(code, round_id), player_id, delta);
  }

  /* Game */
  async getGame(code: RoomCode): Promise<RoomGame | null> {
    const raw = await redis.get(keys.game(code));
    if (!raw) return null;
    return safeJsonParse<RoomGame>(raw);
  }

  async setGame(code: RoomCode, game: RoomGame): Promise<void> {
    await redis.set(keys.game(code), jsonStringifyStable(game));
  }

  /* Rounds */
  async getRound(code: RoomCode, round_id: RoundId): Promise<RoomRound | null> {
    const raw = await redis.get(keys.round(code, round_id));
    if (!raw) return null;
    return safeJsonParse<RoomRound>(raw);
  }

  async setRound(code: RoomCode, round_id: RoundId, round: RoomRound): Promise<void> {
    await redis.set(keys.round(code, round_id), jsonStringifyStable(round));
  }

  /* Votes */
  async resetVotes(code: RoomCode, round_id: RoundId, item_id: ItemId): Promise<void> {
    await redis.del(keys.votes(code, round_id, item_id));
  }

  async setVote(code: RoomCode, round_id: RoundId, item_id: ItemId, player_id: PlayerId, vote: VoteValue): Promise<void> {
    await redis.hset(keys.votes(code, round_id, item_id), player_id, jsonStringifyStable(vote));
  }

  async getVotesAll(code: RoomCode, round_id: RoundId, item_id: ItemId): Promise<Record<string, VoteValue>> {
    const raw = await redis.hgetall(keys.votes(code, round_id, item_id));
    const out: Record<string, VoteValue> = {};
    for (const [pid, v] of Object.entries(raw)) {
      const parsed = safeJsonParse<VoteValue>(v);
      if (parsed) out[pid] = parsed;
    }
    return out;
  }

  /* Close */
  async deleteRoomByScan(code: RoomCode): Promise<void> {
    let cursor = "0";
    const pattern = keys.scanPrefix(code);
    do {
      const res = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
      cursor = res[0];
      const batch = res[1];
      if (batch.length) await redis.del(batch);
    } while (cursor !== "0");
  }

  /* TTL helper for room creation */
  async expireAllRoomKeysAtCreate(code: RoomCode, roundIds: RoundId[]): Promise<void> {
    const base = [
      keys.meta(code),
      keys.senders(code),
      keys.players(code),
      keys.game(code),
      keys.claims(code),
      keys.scores(code),
    ];
    const rounds = roundIds.map((rid) => keys.round(code, rid));
    await expireKeys([...base, ...rounds]);
    // votes + round_delta created later (they’ll need expire when created)
  }

  async expireKey(key: string): Promise<void> {
    // apply standard TTL
    await redis.expire(key, Number(process.env.ROOM_TTL_SECONDS ?? 43200));
  }
}
```

```ts
// src/ws/wsServer.ts
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { Registry } from "./broadcast.js";
import { parseClientMsg } from "./validators.js";
import { routeMessage } from "./router.js";
import { sendError } from "./errors.js";
import { RoomRepo } from "../redis/roomRepo.js";

export type ServerDeps = {
  registry: Registry;
  repo: RoomRepo;
};

export function createHttpServer(): http.Server {
  // simple health endpoint
  return http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

export function attachWs(server: http.Server, deps: ServerDeps) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws.on("message", async (buf) => {
      const raw = typeof buf === "string" ? buf : buf.toString("utf8");
      const msg = parseClientMsg(raw);
      if (!msg || typeof msg.type !== "string") {
        sendError(ws, "bad_request", { message: "invalid_message" });
        return;
      }
      try {
        await routeMessage({ ws, registry: deps.registry, repo: deps.repo }, msg);
      } catch (e) {
        sendError(ws, "bad_request", { message: "handler_error" });
      }
    });

    ws.on("close", () => {
      deps.registry.leave(ws);
    });
  });

  return wss;
}
```

```ts
// src/ws/router.ts
import type WebSocket from "ws";
import type { Registry } from "./broadcast.js";
import type { RoomRepo } from "../redis/roomRepo.js";
import type { ClientToServerMsg } from "./messages.js";
import { sendError } from "./errors.js";

// Domain handlers (stubs for now)
import { createRoom } from "../domain/room.js";
import { joinRoom, takePlayer, renamePlayer, updateAvatar, togglePlayer, startGame } from "../domain/lobby.js";
import { reelOpened, submitVote, endItem, startNextRound } from "../domain/game.js";
import { stateSync } from "../domain/sync.js";
import { roomClosed } from "../domain/close.js";

export type Ctx = { ws: WebSocket; registry: Registry; repo: RoomRepo };

export async function routeMessage(ctx: Ctx, msg: ClientToServerMsg): Promise<void> {
  switch (msg.type) {
    case "CREATE_ROOM":
      return createRoom(ctx, msg.payload);
    case "JOIN_ROOM":
      return joinRoom(ctx, msg.payload);
    case "TAKE_PLAYER":
      return takePlayer(ctx, msg.payload);
    case "RENAME_PLAYER":
      return renamePlayer(ctx, msg.payload);
    case "UPDATE_AVATAR":
      return updateAvatar(ctx, msg.payload);
    case "TOGGLE_PLAYER":
      return togglePlayer(ctx, msg.payload);
    case "START_GAME":
      return startGame(ctx, msg.payload);
    case "REEL_OPENED":
      return reelOpened(ctx, msg.payload);
    case "SUBMIT_VOTE":
      return submitVote(ctx, msg.payload);
    case "END_ITEM":
      return endItem(ctx, msg.payload);
    case "START_NEXT_ROUND":
      return startNextRound(ctx, msg.payload);
    case "STATE_SYNC":
      return stateSync(ctx, msg.payload);
    case "ROOM_CLOSED":
      return roomClosed(ctx, msg.payload);
    default:
      sendError(ctx.ws, "bad_request", { message: "unknown_type" });
      return;
  }
}
```

```ts
// src/domain/room.ts (stub, compiles)
import type { Ctx } from "../ws/router.js";
import type { CreateRoomReq, RoomCreatedMsg, PlayerAll, SenderAll } from "../ws/messages.js";
import { genMasterKey, genRoomCode } from "../utils/ids.js";
import { sha256Tagged } from "../utils/hash.js";
import { nowMs } from "../utils/time.js";

export async function createRoom(ctx: Ctx, payload: CreateRoomReq): Promise<void> {
  const code = genRoomCode();
  const master_key = genMasterKey();
  const created_at = nowMs();
  const expires_at = created_at + 12 * 60 * 60 * 1000;

  const meta = {
    code,
    created_at,
    expires_at,
    phase: "lobby" as const,
    version: 1,
    master_key_hash: sha256Tagged(master_key),
  };

  const sendersAll: SenderAll[] = payload.senders.map((s) => ({
    sender_id: s.sender_id,
    name: s.name,
    active: s.active,
    reels_count: s.reels_count,
  }));

  const playersAll: PlayerAll[] = payload.senders.map((s) => ({
    player_id: `p_${s.sender_id}`,
    sender_id: s.sender_id,
    is_sender_bound: true,
    active: s.active,
    name: s.name,
    avatar_url: null,
  }));

  const round_order = payload.round_order ?? payload.rounds.map((r) => r.round_id);

  const game = {
    phase: "lobby" as const,
    round_order,
    current_round_id: null,
    current_item_index: null,
    status: "idle" as const,
    current_vote: null,
    votes_received_player_ids: null,
    current_vote_results: null,
    version: 1,
  };

  await ctx.repo.setMeta(code, meta);
  await ctx.repo.setSendersAll(code, sendersAll);
  await ctx.repo.setPlayersAll(code, playersAll);
  await ctx.repo.setGame(code, game);

  // scores init
  // (minimal: set empty then increments later; better init now)
  // We keep it minimal; you'll fill properly in the real implementation.

  // rounds
  for (const r of payload.rounds) {
    await ctx.repo.setRound(code, r.round_id, {
      round_id: r.round_id,
      created_at,
      items: r.items.map((it) => ({
        item_id: it.item_id,
        reel: it.reel,
        true_sender_ids: it.true_sender_ids,
        k: it.true_sender_ids.length,
      })),
    });
  }

  await ctx.repo.expireAllRoomKeysAtCreate(code, round_order);

  // join master socket to room
  ctx.registry.joinRoom(ctx.ws, code);
  ctx.registry.setMeta(ctx.ws, { code, is_master: true });

  // reply
  const claims = await ctx.repo.getClaims(code);
  const players_visible = ctx.repo.buildPlayersVisible(playersAll, claims);
  const senders_visible = ctx.repo.buildSendersVisible(sendersAll);

  const msg: RoomCreatedMsg = {
    type: "ROOM_CREATED",
    payload: { code, master_key, phase: "lobby", players_visible, senders_visible },
  };
  ctx.registry.send(ctx.ws, msg);
}
```

```ts
// src/domain/lobby.ts (stubs, compile)
import type { Ctx } from "../ws/router.js";
import type {
  JoinRoomReq,
  JoinOkMsg,
  TakePlayerReq,
  RenamePlayerReq,
  UpdateAvatarReq,
  TogglePlayerReq,
  StartGameReq,
} from "../ws/messages.js";
import { sendError } from "../ws/errors.js";
import { validateAvatarDataUrl } from "../ws/validators.js";

export async function joinRoom(ctx: Ctx, payload: JoinRoomReq): Promise<void> {
  const meta = await ctx.repo.getMeta(payload.code);
  if (!meta) return sendError(ctx.ws, "room_not_found", { code: payload.code });
  if (meta.expires_at <= Date.now()) return sendError(ctx.ws, "room_expired", { code: payload.code });

  ctx.registry.joinRoom(ctx.ws, payload.code);
  ctx.registry.setMeta(ctx.ws, { code: payload.code, device_id: payload.device_id });

  const playersAll = (await ctx.repo.getPlayersAll(payload.code)) ?? [];
  const sendersAll = (await ctx.repo.getSendersAll(payload.code)) ?? [];
  const claims = await ctx.repo.getClaims(payload.code);

  const msg: JoinOkMsg = {
    type: "JOIN_OK",
    payload: {
      code: payload.code,
      phase: meta.phase,
      players_visible: ctx.repo.buildPlayersVisible(playersAll, claims),
    },
  };
  ctx.registry.send(ctx.ws, msg);
}

export async function takePlayer(_ctx: Ctx, _payload: TakePlayerReq): Promise<void> {
  // TODO (Lua + broadcast)
  sendError(_ctx.ws, "bad_request", { code: _payload.code, message: "takePlayer_not_implemented" });
}

export async function renamePlayer(_ctx: Ctx, _payload: RenamePlayerReq): Promise<void> {
  // TODO
  sendError(_ctx.ws, "bad_request", { code: _payload.code, message: "renamePlayer_not_implemented" });
}

export async function updateAvatar(ctx: Ctx, payload: UpdateAvatarReq): Promise<void> {
  const ok = validateAvatarDataUrl(payload.image);
  if (!ok.ok) return sendError(ctx.ws, "bad_request", { code: payload.code, message: "invalid_avatar", details: { reason: ok.reason } });
  // TODO claim check + set players + broadcast
  sendError(ctx.ws, "bad_request", { code: payload.code, message: "updateAvatar_not_implemented" });
}

export async function togglePlayer(_ctx: Ctx, _payload: TogglePlayerReq): Promise<void> {
  // TODO
  sendError(_ctx.ws, "bad_request", { code: _payload.code, message: "togglePlayer_not_implemented" });
}

export async function startGame(_ctx: Ctx, _payload: StartGameReq): Promise<void> {
  // TODO
  sendError(_ctx.ws, "bad_request", { code: _payload.code, message: "startGame_not_implemented" });
}
```

```ts
// src/domain/game.ts (stubs, compile)
import type { Ctx } from "../ws/router.js";
import type { ReelOpenedReq, SubmitVoteReq, EndItemReq, StartNextRoundReq } from "../ws/messages.js";
import { sendError } from "../ws/errors.js";

export async function reelOpened(ctx: Ctx, payload: ReelOpenedReq): Promise<void> {
  sendError(ctx.ws, "bad_request", { code: payload.code, message: "reelOpened_not_implemented" });
}

export async function submitVote(ctx: Ctx, payload: SubmitVoteReq): Promise<void> {
  sendError(ctx.ws, "bad_request", { code: payload.code, message: "submitVote_not_implemented" });
}

export async function endItem(ctx: Ctx, payload: EndItemReq): Promise<void> {
  sendError(ctx.ws, "bad_request", { code: payload.code, message: "endItem_not_implemented" });
}

export async function startNextRound(ctx: Ctx, payload: StartNextRoundReq): Promise<void> {
  sendError(ctx.ws, "bad_request", { code: payload.code, message: "startNextRound_not_implemented" });
}
```

```ts
// src/domain/sync.ts (stub, compile)
import type { Ctx } from "../ws/router.js";
import type { StateSyncReq, StateSyncResponseMsg } from "../ws/messages.js";
import { sendError } from "../ws/errors.js";
import { verifyMasterKey } from "../ws/auth.js";

export async function stateSync(ctx: Ctx, payload: StateSyncReq): Promise<void> {
  const meta = await ctx.repo.getMeta(payload.code);
  if (!meta) return sendError(ctx.ws, "room_not_found", { code: payload.code });
  if (meta.expires_at <= Date.now()) return sendError(ctx.ws, "room_expired", { code: payload.code });

  ctx.registry.joinRoom(ctx.ws, payload.code);
  ctx.registry.setMeta(ctx.ws, { code: payload.code, device_id: payload.device_id });

  const playersAll = (await ctx.repo.getPlayersAll(payload.code)) ?? [];
  const sendersAll = (await ctx.repo.getSendersAll(payload.code)) ?? [];
  const claims = await ctx.repo.getClaims(payload.code);
  const scores = await ctx.repo.getScores(payload.code);
  const game = await ctx.repo.getGame(payload.code);

  const players_visible = ctx.repo.buildPlayersVisible(playersAll, claims);
  const senders_visible = ctx.repo.buildSendersVisible(sendersAll);

  let my_player_id: string | null = null;
  for (const [pid, did] of Object.entries(claims)) {
    if (did === payload.device_id) {
      my_player_id = pid;
      break;
    }
  }

  const isMaster = Boolean(payload.master_key && verifyMasterKey(meta.master_key_hash, payload.master_key));
  if (isMaster) ctx.registry.setMeta(ctx.ws, { is_master: true });

  const msg: StateSyncResponseMsg = {
    type: "STATE_SYNC_RESPONSE",
    payload: {
      code: payload.code,
      phase: meta.phase,
      players_visible,
      senders_visible,
      players_all: isMaster ? playersAll : undefined,
      senders_all: isMaster ? sendersAll : undefined,
      my_player_id,
      game: game
        ? {
            current_round_id: game.current_round_id,
            current_item_index: game.current_item_index,
            status: game.status,
            item: null, // TODO build from round + index
            votes_received_player_ids: isMaster && game.status === "vote" ? game.votes_received_player_ids ?? [] : undefined,
            current_vote_results: isMaster && game.status === "reveal_wait" ? (game.current_vote_results ?? undefined) : undefined,
          }
        : null,
      scores,
    },
  };

  ctx.registry.send(ctx.ws, msg);
}
```

```ts
// src/domain/close.ts (stub, compile)
import type { Ctx } from "../ws/router.js";
import type { RoomClosedReq, RoomClosedBroadcastMsg } from "../ws/messages.js";
import { sendError } from "../ws/errors.js";
import { verifyMasterKey } from "../ws/auth.js";

export async function roomClosed(ctx: Ctx, payload: RoomClosedReq): Promise<void> {
  const meta = await ctx.repo.getMeta(payload.code);
  if (!meta) return sendError(ctx.ws, "room_not_found", { code: payload.code });
  if (!verifyMasterKey(meta.master_key_hash, payload.master_key)) return sendError(ctx.ws, "forbidden", { code: payload.code });

  await ctx.repo.deleteRoomByScan(payload.code);

  const msg: RoomClosedBroadcastMsg = {
    type: "ROOM_CLOSED_BROADCAST",
    payload: { code: payload.code, reason: "closed_by_master" },
  };
  ctx.registry.broadcast(payload.code, msg);
}
```

```ts
// src/index.ts
import { CONFIG } from "./config.js";
import { createHttpServer, attachWs } from "./ws/wsServer.js";
import { Registry } from "./ws/broadcast.js";
import { RoomRepo } from "./redis/roomRepo.js";

async function main() {
  const server = createHttpServer();
  const registry = new Registry();
  const repo = new RoomRepo();

  attachWs(server, { registry, repo });

  server.listen(CONFIG.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`brainrot backend listening on :${CONFIG.PORT}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
```

```json
// package.json (minimal)
{
  "name": "brainrot-party-backend",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "node --watch --enable-source-maps dist/index.js",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "ioredis": "^5.4.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

```json
// tsconfig.json (node16 ESM-friendly)
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "sourceMap": true
  },
  "include": ["src"]
}
```
