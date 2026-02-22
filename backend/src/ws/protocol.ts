// backend/src/ws/protocol.ts

export type WSMsg = {
  type: string;
  req_id?: string;
  ts?: number;
  payload?: any;
};

/**
 * Codes d'erreur normalisés (Lobby + Game).
 * Objectif: permettre au front de router/afficher des messages sans heuristique fragile.
 */
export type WSErrorCode =
  // Lobby
  | "LOBBY_NOT_FOUND"
  | "LOBBY_CLOSED"
  | "MASTER_KEY_INVALID"
  | "FORBIDDEN"
  | "NOT_AVAILABLE"
  | "TAKEN"
  | "ALREADY_CLAIMED"
  | "DOUBLE_DEVICE"
  | "TOKEN_INVALID"
  // Game
  | "ROOM_NOT_FOUND"
  | "NOT_IN_GAME"
  | "VOTING_CLOSED"
  | "BAD_REQUEST"
  // Generic
  | "UNKNOWN"
  | "ERROR";

export function ack(req_id: string | undefined, payload: any = {}) {
  return { type: "ack", req_id, ts: Date.now(), payload };
}

export function err(
  req_id: string | undefined,
  code: WSErrorCode | string,
  message: string,
  extra?: Record<string, any>
) {
  return {
    type: "error",
    req_id,
    ts: Date.now(),
    payload: { code, message, ...(extra || {}) },
  };
}

/**
 * Helpers optionnels (usage recommandé)
 */
export const ERR = {
  lobbyNotFound: (req_id?: string) => err(req_id, "LOBBY_NOT_FOUND", "Lobby introuvable"),
  tokenInvalid: (req_id?: string) => err(req_id, "TOKEN_INVALID", "Token invalide"),
  taken: (req_id?: string) => err(req_id, "TAKEN", "Pris à l’instant"),
  forbidden: (req_id?: string) => err(req_id, "FORBIDDEN", "Action interdite"),
  badRequest: (req_id?: string) => err(req_id, "BAD_REQUEST", "Requête invalide"),
};
