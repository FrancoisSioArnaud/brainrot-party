import type Redis from "ioredis";
import { deviceToPlayerKey, playerToDeviceKey } from "./claimKeys.js";
import { LUA_CLAIM_PLAYER, LUA_RELEASE_BY_DEVICE, LUA_RELEASE_BY_PLAYER } from "./claimLua.js";

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "device_already_has_player" | "taken_now" | "inactive" | "player_not_found" };

export class ClaimRepo {
  constructor(private redis: Redis) {}

  async claim(roomCode: string, deviceId: string, playerId: string, playerExists: boolean, playerActive: boolean): Promise<ClaimResult> {
    const res = (await this.redis.eval(
      LUA_CLAIM_PLAYER,
      2,
      deviceToPlayerKey(roomCode),
      playerToDeviceKey(roomCode),
      deviceId,
      playerId,
      playerExists ? "1" : "0",
      playerActive ? "1" : "0"
    )) as number;

    if (res === 0) return { ok: true };
    if (res === 1) return { ok: false, reason: "device_already_has_player" };
    if (res === 2) return { ok: false, reason: "taken_now" };
    if (res === 3) return { ok: false, reason: "inactive" };
    return { ok: false, reason: "player_not_found" };
  }

  async releaseByPlayer(roomCode: string, playerId: string): Promise<void> {
    await this.redis.eval(
      LUA_RELEASE_BY_PLAYER,
      2,
      deviceToPlayerKey(roomCode),
      playerToDeviceKey(roomCode),
      playerId
    );
  }

  async releaseByDevice(roomCode: string, deviceId: string): Promise<void> {
    await this.redis.eval(
      LUA_RELEASE_BY_DEVICE,
      2,
      deviceToPlayerKey(roomCode),
      playerToDeviceKey(roomCode),
      deviceId
    );
  }

  async getPlayerForDevice(roomCode: string, deviceId: string): Promise<string | null> {
    return (await this.redis.hget(deviceToPlayerKey(roomCode), deviceId)) ?? null;
  }

  async getDeviceForPlayer(roomCode: string, playerId: string): Promise<string | null> {
    return (await this.redis.hget(playerToDeviceKey(roomCode), playerId)) ?? null;
  }

  async delClaims(roomCode: string): Promise<void> {
    await this.redis.del(deviceToPlayerKey(roomCode), playerToDeviceKey(roomCode));
  }

  async touchClaims(roomCode: string, ttlSeconds: number): Promise<void> {
    await this.redis
      .pipeline()
      .expire(deviceToPlayerKey(roomCode), ttlSeconds)
      .expire(playerToDeviceKey(roomCode), ttlSeconds)
      .exec();
  }
}
