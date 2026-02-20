import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "path";

import { registerHttpRoutes } from "./http/routes";
import { registerLobbyWS } from "./ws/lobbyWs";
import { registerGameWS } from "./ws/gameWs";

const app = Fastify({ logger: true });

// WS
await app.register(websocket);

// multipart (photo upload)
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// serve temp photos
const TEMP_DIR = path.resolve(process.env.BRP_TEMP_DIR || "/tmp/brp");
await app.register(fastifyStatic, {
  root: TEMP_DIR,
  prefix: "/temp/" // /temp/<join>/<player>.jpg
});

await registerHttpRoutes(app);
await registerLobbyWS(app);
await registerGameWS(app);

const port = Number(process.env.PORT || 3010);
await app.listen({ port, host: "0.0.0.0" });
