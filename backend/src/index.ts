import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config";
import { registerHttpRoutes } from "./http/routes";
import { registerLobbyWS } from "./ws/lobbyWs";
import { registerGameWS } from "./ws/gameWs";

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin });
await app.register(websocket);

await registerHttpRoutes(app);
await registerLobbyWS(app);
await registerGameWS(app);

app.listen({ port: config.port, host: "0.0.0.0" }).then(() => {
  app.log.info(`brainrot-party-backend listening on :${config.port}`);
});
