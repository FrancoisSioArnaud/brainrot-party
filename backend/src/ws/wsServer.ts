// backend/src/ws/wsServer.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type WebSocket from "ws";

import type { RoomRepo } from "../state/roomRepo.js";
import { PROTOCOL_VERSION } from "@brp/contracts";

// IMPORTANT: keep your existing router import/path
import { handleWsMessage } from "./wsRouter.js";

function pickWs(arg: any): WebSocket {
  // @fastify/websocket passes (connection, req) where connection.socket is the WebSocket.
  // Some setups pass ws directly. Support both.
  const ws = arg?.socket ?? arg;
  if (!ws || typeof ws.on !== "function") {
    throw new TypeError("WS handler: cannot resolve websocket instance (missing .on)");
  }
  return ws as WebSocket;
}

export function registerWs(app: FastifyInstance, repo: RoomRepo) {
  app.get(
    "/ws",
    { websocket: true },
    (connection: any, req: FastifyRequest) => {
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
        handleWsMessage({ app, repo, ws, raw, req }).catch((err: unknown) => {
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

      ws.on("error", (err: unknown) => {
        app.log.error({ err }, "WS error");
      });
    }
  );
}
