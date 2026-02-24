import type { RoomMeta } from "./roomRepo.js";
import { genMasterKey, genPlayerId, genRoomCode } from "../utils/ids.js";
import { sha256Hex } from "../utils/hash.js";
import { PROTOCOL_VERSION } from "@brp/contracts";
import type { SenderAll, PlayerAll, Phase } from "@brp/contracts";

export type RoomStateInternal = {
  room_code: string;
  phase: Phase;
  players: PlayerAll[];
  senders: SenderAll[];
  game: null;
  scores: Record<string, number>;
};

export function buildNewRoom(): {
  code: string;
  masterKey: string;
  meta: RoomMeta;
  state: RoomStateInternal;
} {
  const code = genRoomCode(6);
  const masterKey = genMasterKey();
  const now = Date.now();

  const players: PlayerAll[] = Array.from({ length: 8 }).map((_, idx) => {
    const id = genPlayerId();
    return {
      player_id: id,
      sender_id: `sender_${idx + 1}`,
      is_sender_bound: false,
      active: true,
      name: `Joueur ${idx + 1}`,
      avatar_url: null,
    };
  });

  const state: RoomStateInternal = {
    room_code: code,
    phase: "lobby",
    players,
    senders: [],
    game: null,
    scores: Object.fromEntries(players.map((p) => [p.player_id, 0])),
  };

  const meta: RoomMeta = {
    room_code: code,
    created_at: now,
    expires_at: now + 86400_000,
    master_hash: sha256Hex(masterKey),
    protocol_version: PROTOCOL_VERSION,
  };

  return { code, masterKey, meta, state };
}
