import Fastify from "fastify";
import Redis from "ioredis";

import { config } from "./config.js";
import { logger } from "./logger.js";

import { RoomRepo } from "./state/roomRepo.js";
import { registerHttpRoutes } from "./http/routes.js";
import { registerWs } from "./ws/wsServer.js";

async function main() {
  const app = Fastify({ logger });

  const redis = new Redis(config.redisUrl);
  const repo = new RoomRepo(redis);

  await registerHttpRoutes(app, repo);
  await registerWs(app, repo);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "backend started");
}

main().catch((err) => {
  logger.error(err, "fatal");
  process.exit(1);
});
