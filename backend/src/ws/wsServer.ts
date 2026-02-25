// backend/src/ws/wsServer.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type WebSocket from "ws";
import type { SocketStream } from "@fastify/websocket";

import type { RoomRepo } from "../state/roomRepo.js";
import { handleWsMessage } from "./wsRouter.js"; // adapte si ton router a un autre nom
import { PROTOCOL_VERSION } from "@brp/contracts";

function pickWs(arg: any): WebSocket {
  // @fastify/websocket normally passes (connection: SocketStream, req)
  // where connection.socket is the WebSocket instance.
  // Some codebases treat the first arg as the ws directly.
  const ws = (arg && arg.socket) ? (arg.socket as WebSocket) : (arg as WebSocket);
  if (!ws || typeof (ws as any).on !== "function") {
    throw new TypeError("WS handler: cannot resolve websocket instance (missing .on)");
  }
  return ws;
}

export function registerWsServer(app: FastifyInstance, repo: RoomRepo) {
  // IMPORTANT: websocket: true => fastify-websocket upgrades GET /ws
  app.get(
    "/ws",
    { websocket: true },
    (connection: SocketStream | WebSocket, req: FastifyRequest) => {
      const ws = pickWs(connection);

      app.log.info(
        {
          ip: req.ip,
          url: req.url,
          protocol_version: PROTOCOL_VERSION,
        },
        "WS connected"
      );

      ws.on("message", (buf: WebSocket.RawData) => {
        const raw = typeof buf === "string" ? buf : buf.toString();
        handleWsMessage({ app, repo, ws, raw, req }).catch((err) => {
          app.log.error({ err }, "WS message handler failed");
          try {
            ws.close();
          } catch {
            // ignore
          }
        });
      });

      ws.on("close", (code: number, reason: Buffer) => {
        app.log.info({ code, reason: reason?.toString?.() }, "WS closed");
      });

      ws.on("error", (err: Error) => {
        app.log.error({ err }, "WS error");
      });
    }
  );
}
