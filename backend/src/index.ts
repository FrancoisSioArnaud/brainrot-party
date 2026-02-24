import Fastify from "fastify";
import { Redis } from "ioredis";

import { config } from "./config.js";
import { fastifyLoggerOptions } from "./logger.js";

import { RoomRepo } from "./state/roomRepo.js";
import { registerHttpRoutes } from "./http/routes.js";
import { registerWs } from "./ws/wsServer.js";

async function main() {
  const app = Fastify({ logger: fastifyLoggerOptions });

  const redis = new Redis(config.redisUrl);
  const repo = new RoomRepo(redis);

  await registerHttpRoutes(app, repo);
  await registerWs(app, repo);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info({ port: config.port }, "backend started");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
