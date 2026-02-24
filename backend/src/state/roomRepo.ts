import Redis from "ioredis";
import { config } from "../config.js";
import { roomMetaKey, roomStateKey } from "./roomKeys.js";
import { deviceToPlayerKey, playerToDeviceKey } from "./claimKeys.js";

export type RoomMeta = {
  room_code: string;
  created_at: number;
  expires_at: number;
  master_hash: string;
  protocol_version: number;
};

export class RoomRepo {
  constructor(private redis: Redis) {}

  async touchRoomAll(code: string): Promise<void> {
    const ttl = config.roomTtlSeconds;
    const pipeline = this.redis.pipeline();
    pipeline.expire(roomMetaKey(code), ttl);
    pipeline.expire(roomStateKey(code), ttl);
    pipeline.expire(deviceToPlayerKey(code), ttl);
    pipeline.expire(playerToDeviceKey(code), ttl);
    await pipeline.exec();
  }

  async delRoomAll(code: string): Promise<void> {
    await this.redis.del(
      roomMetaKey(code),
      roomStateKey(code),
      deviceToPlayerKey(code),
      playerToDeviceKey(code)
    );
  }
  
  async setRoom(code: string, meta: RoomMeta, state: unknown): Promise<void> {
    const ttl = config.roomTtlSeconds;
    const pipeline = this.redis.pipeline();
    pipeline.set(roomMetaKey(code), JSON.stringify(meta), "EX", ttl);
    pipeline.set(roomStateKey(code), JSON.stringify(state), "EX", ttl);
    await pipeline.exec();
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

  async touch(code: string): Promise<void> {
    const ttl = config.roomTtlSeconds;
    const pipeline = this.redis.pipeline();
    pipeline.expire(roomMetaKey(code), ttl);
    pipeline.expire(roomStateKey(code), ttl);
    await pipeline.exec();
  }

  async delRoom(code: string): Promise<void> {
    await this.redis.del(roomMetaKey(code), roomStateKey(code));
  }
}
