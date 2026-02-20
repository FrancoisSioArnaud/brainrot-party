import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3010),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  nodeEnv: process.env.NODE_ENV || "development"
};
