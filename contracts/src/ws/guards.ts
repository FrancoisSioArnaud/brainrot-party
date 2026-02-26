// contracts/src/ws/guards.ts
import type { ClientToServerMsg } from "./messages.js";

/**
 * Minimal runtime guard.
 * This does NOT deeply validate payloads; it only checks envelope shape + known type string.
 * Backend should still validate per-message fields.
 */
const CLIENT_TYPES = new Set<string>([
  "JOIN_ROOM",
  "REQUEST_SYNC",
  "TOGGLE_PLAYER",
  "RESET_CLAIMS",
  "ADD_PLAYER",
  "DELETE_PLAYER",
  "START_GAME",
  "REEL_OPENED",
  "END_ITEM",
  "START_NEXT_ROUND",
  "ROOM_CLOSED",
  "TAKE_PLAYER",
  "RELEASE_PLAYER",
  "RENAME_PLAYER",
  "UPDATE_AVATAR",
  "SUBMIT_VOTE",
]);

export function isClientToServerMsg(x: unknown): x is ClientToServerMsg {
  if (typeof x !== "object" || x === null) return false;
  const anyX = x as any;
  if (typeof anyX.type !== "string") return false;
  if (!CLIENT_TYPES.has(anyX.type)) return false;
  if (typeof anyX.payload !== "object" || anyX.payload === null) return false;
  return true;
}
