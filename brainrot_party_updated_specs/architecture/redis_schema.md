# Brainrot Party — Redis Schema (Canonical)

Redis is the authoritative storage for ephemeral rooms (lobby/game). No relational DB is required for MVP.

## Keyspace prefix
All keys use:
- `brp:` prefix

Room code is the primary partition key.

---

## TTL policy

### Default TTL
- Room TTL: **24h**
- TTL is refreshed on:
  - any state mutation
  - JOIN_ROOM (optional but recommended)
  - REQUEST_SYNC (optional)

### Expiration behavior
When TTL elapsed:
- Server treats room as expired and rejects actions with `room_expired`.
- Server may lazily delete leftover keys if any remain.

---

## Keys per room

### 1) Room meta
**Key:** `brp:room:{code}:meta`  
**Type:** JSON string

**Value shape:**
```json
{
  "room_code": "AB12CD",
  "created_at": 1700000000000,
  "expires_at": 1700086400000,
  "master_hash": "sha256:....",
  "protocol_version": 1
}
````

Notes:

* `master_hash` is a one-way hash of the `master_key` returned by `POST /room`.

---

### 2) Room state (authoritative)

**Key:** `brp:room:{code}:state`
**Type:** JSON string

**Value shape (high-level):**

```json
{
  "room_code": "AB12CD",
  "phase": "lobby",
  "lobby": {
    "players": [ ... ],
    "senders": [ ... ]
  },
  "game": null,
  "scores": { "p1": 0, "p2": 0 }
}
```

This is the single source of truth used to build `STATE_SYNC_RESPONSE`.

---

### 3) Device ↔ player claim mapping (optional but recommended)

To make reconnect and “1 device = 1 player” strict and fast, keep a mapping.

**Key:** `brp:room:{code}:device_to_player`
**Type:** Redis HASH
**Fields:** `{device_id} -> {player_id}`

**Key:** `brp:room:{code}:player_to_device`
**Type:** Redis HASH
**Fields:** `{player_id} -> {device_id}`

If you store `claimed_by` inside `state`, you can rebuild these maps at load, but the hash maps make atomic claim easier.

---

### 4) Current vote storage (optional, can be inside state)

You can store votes inside the room state JSON, but separate keys are useful to reduce JSON churn and enable atomic ops.

**Key:** `brp:room:{code}:vote:{round_id}:{item_id}`
**Type:** Redis HASH
**Fields:** `{player_id} -> JSON(selections[])`

Example field value:

```json
["senderA","senderB","senderC"]
```

**Key:** `brp:room:{code}:vote_received:{round_id}:{item_id}`
**Type:** Redis SET
**Members:** `player_id`

This directly powers master-only `votes_received_player_ids`.

---

## Atomic operations (Lua recommended)

### Claim player (TAKE_PLAYER)

Goal:

* prevent two devices claiming the same player
* prevent one device claiming multiple players
* validate active flag (from state) or a parallel active map

Recommended approach:

* Keep `player_to_device` and `device_to_player` hashes
* Use a Lua script:

Pseudo:

1. If `HEXISTS device_to_player device_id` → fail `device_already_has_player`
2. If `HEXISTS player_to_device player_id` → fail `taken_now`
3. (Optional) validate player active (either:

   * load state JSON and check, or
   * keep `brp:room:{code}:player_active` hash for fast checks)
4. `HSET player_to_device player_id device_id`
5. `HSET device_to_player device_id player_id`
6. Return OK

Then update the authoritative `state` JSON accordingly and broadcast.

---

### Store vote (SUBMIT_VOTE)

Goal:

* one vote per player per item
* validate k and selectable set in server memory/state
* prevent duplicate vote

Recommended:

* Use `HSETNX` on `vote:{round}:{item}`:

  * if exists already → `already_voted`
* Add player to `vote_received` set.

---

## State building for clients

### players_visible / senders_visible

Derived from authoritative state:

* visible includes all players/senders but clients may display disabled as grey.
* `PlayerStatus` computed:

  * `taken` if `player_to_device[player_id]` exists
  * else `free`

### my_player_id

Derived from connection:

* lookup `device_to_player[device_id]` if present
* validate the player still exists and is active

### Master-only fields

If connection is master (master_key validated at JOIN):

* include `players_all`, `senders_all`
* include:

  * `votes_received_player_ids` from `vote_received:*` set when `status="vote"`
  * `current_vote_results` if `status="reveal_wait"` (computed or cached)

---

## Room deletion

On `ROOM_CLOSED`:

* delete all keys matching:

  * `brp:room:{code}:*`
* disconnect sockets

On expiration:

* lazy delete when a request arrives for an expired room.

---

## Minimal “keys list” for ops/debug

* `brp:room:{code}:meta`
* `brp:room:{code}:state`
* `brp:room:{code}:device_to_player`
* `brp:room:{code}:player_to_device`
* `brp:room:{code}:vote:{round}:{item}`
* `brp:room:{code}:vote_received:{round}:{item}`
