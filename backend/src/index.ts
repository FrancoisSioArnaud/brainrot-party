import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";

import { registerHttpRoutes } from "./http/routes";
import { registerLobbyWS } from "./ws/lobbyWs";
import { registerGameWS } from "./ws/gameWs";

const app = Fastify({ logger: true });

const port = Number(process.env.PORT || 3021);

async function main() {
  await app.register(websocket);

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  });

  const clientDist = path.resolve(process.cwd(), "../frontend/dist");

  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: "/",
    decorateReply: false,
  });

  const gifsDir = path.resolve(process.cwd(), "../frontend/public");

  await app.register(fastifyStatic, {
    root: gifsDir,
    prefix: "/",
    decorateReply: false,
  });

  await registerHttpRoutes(app);
  await registerLobbyWS(app);
  await registerGameWS(app);

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
