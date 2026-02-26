import type { Redis } from "ioredis";
import { config } from "../config.js";
import { roomMetaKey, roomSetupLockKey, roomStateKey } from "./roomKeys.js";
import { deviceToPlayerKey, playerToDeviceKey } from "./claimKeys.js";
import { LUA_SET_SETUP_IF_UNLOCKED } from "./roomLua.js";

export type RoomMeta = {
  room_code: string;
  created_at: number;
  expires_at: number;
  master_hash: string;
  protocol_version: number;
};

export class RoomRepo {
  constructor(public redis: Redis) {}

  async setRoom(code: string, meta: RoomMeta, state: unknown): Promise<void> {
    const ttl = config.roomTtlSeconds;
    const pipeline = this.redis.pipeline();
    pipeline.set(roomMetaKey(code), JSON.stringify(meta), "EX", ttl);
    pipeline.set(roomStateKey(code), JSON.stringify(state), "EX", ttl);
    await pipeline.exec();
  }

  async setState(code: string, state: unknown): Promise<void> {
    const ttl = config.roomTtlSeconds;
    await this.redis.set(roomStateKey(code), JSON.stringify(state), "EX", ttl);
  }

  /**
   * Atomically stores the state and locks setup.
   * Used by POST /room/:code/setup to enforce the single-setup invariant.
   */
  async setStateAndLockSetup(code: string, state: unknown): Promise<boolean> {
    const ttl = config.roomTtlSeconds;
    const res = (await this.redis.eval(
      LUA_SET_SETUP_IF_UNLOCKED,
      2,
      roomStateKey(code),
      roomSetupLockKey(code),
      JSON.stringify(state),
      String(ttl)
    )) as number;

    return res === 1;
  }

  async getMeta(code: string): Promise<RoomMeta | null> {
    const raw = await this.redis.get(roomMetaKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as RoomMeta;
  }

  async getState<T>(code: string): Promise<T | null> {
    const raw = await this.redis.get(roomStateKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async touchRoomAll(code: string): Promise<void> {
    const ttl = config.roomTtlSeconds;
    const pipeline = this.redis.pipeline();
    pipeline.expire(roomMetaKey(code), ttl);
    pipeline.expire(roomStateKey(code), ttl);
    pipeline.expire(roomSetupLockKey(code), ttl);
    pipeline.expire(deviceToPlayerKey(code), ttl);
    pipeline.expire(playerToDeviceKey(code), ttl);
    await pipeline.exec();
  }

  async delRoomAll(code: string): Promise<void> {
    await this.redis.del(
      roomMetaKey(code),
      roomStateKey(code),
      roomSetupLockKey(code),
      deviceToPlayerKey(code),
      playerToDeviceKey(code)
    );
  }
}
