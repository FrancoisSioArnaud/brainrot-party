export interface AppConfig {
  port: number;
  redisUrl: string;
  corsOrigin: string;
  roomTtlSeconds: number;
  nodeEnv: "development" | "production" | "test";
}

function mustInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return v;
}

export const config: AppConfig = {
  port: mustInt("PORT", 3010),
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  roomTtlSeconds: mustInt("ROOM_TTL_SECONDS", 86400),
  nodeEnv: (process.env.NODE_ENV as any) || "development",
};
