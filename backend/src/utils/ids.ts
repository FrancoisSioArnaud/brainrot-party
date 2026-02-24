import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function genRoomCode(len = 6): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function genMasterKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function genPlayerId(): string {
  return crypto.randomUUID();
}
