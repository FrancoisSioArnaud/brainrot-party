# 08 — Redis Keys & JSON Types (exact)

Objectif : figer les clés Redis et la structure JSON exacte de chaque valeur.
Aligné avec :
- Redis schema
- WS protocol
- Invariants
- Avatars : dataURL JPEG 300x300 stockée dans `players[].avatar_url`

TTL : 43200s sur toutes les clés de la room.

Préfixe :
- `room:{code}:...`

---

## 1) Keys (liste complète)

### Core
- `room:{code}:meta` (STRING JSON)
- `room:{code}:senders` (STRING JSON)
- `room:{code}:players` (STRING JSON)
- `room:{code}:game` (STRING JSON)

### Hashes
- `room:{code}:claims` (HASH) : `player_id -> device_id`
- `room:{code}:scores` (HASH) : `player_id -> int`
- `room:{code}:round_delta:{round_id}` (HASH) : `player_id -> int`
- `room:{code}:votes:{round_id}:{item_id}` (HASH) : `player_id -> VoteValueJSON`

### Rounds
- `room:{code}:round:{round_id}` (STRING JSON)

---

## 2) Types exacts (JSON)

Notation : TypeScript-like, mais c’est exactement ce qui est sérialisé en JSON.

### 2.1 `RoomMeta` — `room:{code}:meta`
```ts
type RoomMeta = {
  code: string;
  created_at: number;      // ms epoch
  expires_at: number;      // ms epoch
  phase: "lobby" | "game" | "over";
  version: number;
  master_key_hash: string; // "sha256:<hex>"
};
