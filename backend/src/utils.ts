import { nanoid } from "nanoid";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const DIGITS = "0123456789";

export function makeJoinCode(): string {
  const pick = (chars: string, n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${pick(LETTERS, 2)}${pick(DIGITS, 2)}${pick(LETTERS, 2)}`;
}

export function makeMasterKey(): string {
  return nanoid(32);
}

export function makeRoomCode(): string {
  // Short, URL-safe, no I/O to avoid confusion
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)];
  return Array.from({ length: 8 }, pick).join("");
}

export function nowMs(): number {
  return Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
