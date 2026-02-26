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

type RoomMeta = {
  code: string;
  created_at: number;      // ms epoch
  expires_at: number;      // ms epoch
  phase: "lobby" | "game" | "over";
  version: number;
  master_key_hash: string; // "sha256:<hex>"
};
2.2 SenderAll[] — room:{code}:senders
type SenderAll = {
  sender_id: string;
  name: string;
  active: boolean;
  reels_count: number;
};

type SendersAll = SenderAll[];

Derived (not stored) :

senders_visible = sendersAll.filter(s => s.active)

IMPORTANT :

Les senders ne sont pas nécessaires côté Play (Play ne les affiche pas).

Les senders sont master-only dans le STATE_SYNC_RESPONSE.

2.3 PlayerAll[] — room:{code}:players
type PlayerAll = {
  player_id: string;

  // Sender binding
  is_sender_bound: boolean;
  sender_id: string | null;     // null iff is_sender_bound=false (manual player)

  active: boolean;
  name: string;
  avatar_url: string | null;    // data:image/jpeg;base64,... (300x300)
};

type PlayersAll = PlayerAll[];

Derived (not stored) : players_visible:

active === true only

plus status derived from claims (free|taken)

Manual players (NEW) :

is_sender_bound=false

sender_id=null

player_id generated server-side only

Sender-bound players :

is_sender_bound=true

sender_id present

Rename of the player updates the sender name too (single source of truth)

2.4 RoomGame — room:{code}:game

(unchanged — game loop doc)

2.5 RoomRound — room:{code}:round:{round_id} (immuable)

(unchanged — round items include true_sender_ids + k)

2.6 VoteValue — room:{code}:votes:{round_id}:{item_id} (HASH values)

(unchanged)

3) Hash schemas
3.1 Claims — room:{code}:claims

field: player_id

value: device_id

Invariant : un device_id ne peut apparaître qu’une seule fois (Lua).

4) Room creation: required initial values

At room creation (before setup publish):

meta exists, phase=lobby

senders/players may be empty until setup publish (implementation choice)
At setup publish:

senders/players are written

scores initialized for every player_id

claims empty

game initialized (phase=lobby, idle)

5) Lobby-only mutations

Allowed in phase=lobby only:

Toggle player active

Reset claims

Add/delete manual players

Rename player (and sender if sender-bound)

Release player (change slot)

