# 08 — Redis Keys & JSON Types (exact)

Objectif : figer les clés Redis et la structure JSON exacte de chaque valeur.
Aligné avec :
- Redis schema v3
- WS protocol v3
- State machine v3
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
  created_at: number;   // ms epoch
  expires_at: number;   // ms epoch (created_at + 12h)
  phase: "lobby" | "game" | "over";
  version: number;      // increment on important mutations
  master_key_hash: string; // "sha256:<hex>"
};
````

---

### 2.2 `SenderAll[]` — `room:{code}:senders`

```ts
type SenderAll = {
  sender_id: string;
  name: string;
  active: boolean;
  reels_count: number;
};

type SendersAll = SenderAll[];
```

Derived (not stored) : `senders_visible = sendersAll.filter(s => s.active)`.

---

### 2.3 `PlayerAll[]` — `room:{code}:players`

```ts
type PlayerAll = {
  player_id: string;
  sender_id: string;          // always present (players are created from senders)
  is_sender_bound: true;      // always true in MVP (no manual players in v3)
  active: boolean;
  name: string;
  avatar_url: string | null;  // data:image/jpeg;base64,... (300x300)
};

type PlayersAll = PlayerAll[];
```

Derived (not stored) : `players_visible`:

* `active === true` only
* plus `status` derived from claims (`free|taken`)

---

### 2.4 `RoomGame` — `room:{code}:game`

#### Helper types

```ts
type CurrentVote = {
  round_id: string;
  item_id: string;
  expected_player_ids: string[]; // snapshot at REEL_OPENED
};

type VoteResultPerPlayer = {
  player_id: string;
  selections: string[];   // sender_ids selected
  correct: string[];      // subset of selections that are in true_senders
  incorrect: string[];    // subset of selections that are not in true_senders
  points_gained: number;  // correct.length
  score_total: number;    // score after update
};

type CurrentVoteResults = {
  round_id: string;
  item_id: string;
  true_senders: string[]; // sender_ids
  players: VoteResultPerPlayer[];
};
```

#### Main

```ts
type RoomGame = {
  phase: "lobby" | "game"; // meta.phase is the authoritative phase; this mirrors for convenience
  round_order: string[];   // round_id list in play order

  current_round_id: string | null;
  current_item_index: number | null;

  status: "idle" | "vote" | "reveal_wait" | "round_recap";

  current_vote: CurrentVote | null;

  // Only meaningful when status=vote.
  // null otherwise.
  votes_received_player_ids: string[] | null;

  // Only meaningful when status=reveal_wait.
  // null otherwise.
  current_vote_results: CurrentVoteResults | null;

  version: number; // increment on any game mutation
};
```

Invariants :

* `status=vote` ⇒ `current_vote != null` AND `votes_received_player_ids != null` AND `current_vote_results == null`
* `status=reveal_wait` ⇒ `current_vote != null` AND `current_vote_results != null`
* `status=idle` ⇒ `current_vote == null` AND `current_vote_results == null`
* `status=round_recap` ⇒ `current_vote == null` AND `current_vote_results == null`

---

### 2.5 `RoomRound` — `room:{code}:round:{round_id}` (immuable)

```ts
type RoomRoundItem = {
  item_id: string;
  reel: {
    reel_id: string;
    url: string;
  };
  true_sender_ids: string[]; // ground truth, stored server-side
  k: number;                 // equals true_sender_ids.length
};

type RoomRound = {
  round_id: string;
  created_at: number;
  items: RoomRoundItem[];
};
```

Invariants :

* `k === true_sender_ids.length`
* reels with multi-senders appear once with k>1 (no partial items)

---

### 2.6 `VoteValue` — `room:{code}:votes:{round_id}:{item_id}` (HASH values)

Each field in the hash is a JSON string:

```ts
type VoteValue = {
  selections: string[]; // sender_ids, length must be exactly k (UX)
  ts: number;           // ms epoch
};
```

---

## 3) Hash schemas

### 3.1 Claims — `room:{code}:claims`

* field: `player_id`
* value: `device_id`

### 3.2 Scores — `room:{code}:scores`

* field: `player_id`
* value: `"0" | "1" | ...` (string in Redis, parsed int)

### 3.3 Round delta — `room:{code}:round_delta:{round_id}`

* field: `player_id`
* value: int string

---

## 4) Room creation: required initial values

At `CREATE_ROOM`:

* meta:

  * `phase="lobby"`
  * `version=1`
* senders / players: stored as provided by setup output
* scores: init 0 for every player_id
* claims: empty hash
* game:

  * `phase="lobby"`
  * `round_order` computed or given
  * `current_round_id=null`
  * `current_item_index=null`
  * `status="idle"`
  * `current_vote=null`
  * `votes_received_player_ids=null`
  * `current_vote_results=null`
  * `version=1`
* rounds:

  * `room:{code}:round:{rid}` for each rid

Apply TTL (43200s) to every created key.

---

## 5) Deletions / cleanup rules

* `REEL_OPENED`:

  * `DEL room:{code}:votes:{rid}:{item}`
  * set `game.current_vote`, `votes_received_player_ids=[]`, clear `current_vote_results`

* vote completed (`SUBMIT_VOTE` last):

  * set `game.status="reveal_wait"`
  * set `game.current_vote_results=<computed>`
  * set `votes_received_player_ids=null`

* `END_ITEM`:

  * `DEL votes:{rid}:{item}`
  * clear `game.current_vote` and `game.current_vote_results`
  * advance index
  * set status to `idle` or `round_recap`

* `ROOM_CLOSED`:

  * `SCAN MATCH room:{code}:*` + `DEL` batch

---

## 6) Derived payloads (not stored)

### players_visible derivation

Inputs:

* `PlayersAll`
* `claims`
  Output:

```ts
type PlayerVisible = PlayerAll & { active: true; status: "free" | "taken" };
```

### senders_visible derivation

Inputs:

* `SendersAll`
  Output:
* active==true only

### Item public payload derivation (for NEW_ITEM / STATE_SYNC)

Inputs:

* `RoomGame` pointers + `RoomRound`
  Output:
* reel url, k
* `senders_selectable` = senders_visible (current room) (no “restants” server-side)




