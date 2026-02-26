# 04 — Redis Schema (Clés + JSON + TTL)

Décisions intégrées :
- `STATE_SYNC_RESPONSE` :
  - contient toujours `players_visible`
  - contient aussi `players_all` si Master
  - contient aussi `senders_all` si Master
  - `senders_visible` est master-only (Play ne l’utilise pas / ne l’affiche pas)
- `master_key` stocké hashé (`master_key_hash`)
- TTL 12h fixé à la création, refresh selon implémentation serveur
- Setup strict : publication unique (setup lock)

Préfixe : `room:{code}:...`

---

## 1) Meta

Key :
- `room:{code}:meta` — `STRING(JSON)`

JSON :
```json
{
  "code": "ABCD1234",
  "created_at": 1730000000000,
  "expires_at": 1730043200000,
  "phase": "lobby",
  "version": 1,
  "master_key_hash": "sha256:...."
}

2) Senders (complet) — master-only usage

Key :

room:{code}:senders — STRING(JSON)

JSON :

[
  { "sender_id": "s12", "name": "Camille", "active": true,  "reels_count": 37 },
  { "sender_id": "s44", "name": "Nico",    "active": false, "reels_count": 0 }
]

Note :

Play ne dépend pas de la liste des senders.

3) Players (complet)

Key :

room:{code}:players — STRING(JSON)

JSON :

[
  {
    "player_id": "p_s12",
    "is_sender_bound": true,
    "sender_id": "s12",
    "active": true,
    "name": "Camille",
    "avatar_url": null
  },
  {
    "player_id": "p_manual_1",
    "is_sender_bound": false,
    "sender_id": null,
    "active": true,
    "name": "Player",
    "avatar_url": null
  }
]

Règles :

sender_id est null si et seulement si is_sender_bound=false.

Rename d’un player sender-bound met à jour le sender.name correspondant.

4) Claims

Key :

room:{code}:claims — HASH

field: player_id

value: device_id

Invariant : un device_id ne peut apparaître qu’une seule fois (Lua).

5) Scores (cumul)

Key :

room:{code}:scores — HASH

field: player_id

value: int

6) Game state / rounds / votes

(unchanged)


---

### `brainrot_party_updated_specs/protocol/ws_messages.md`
```md
# Brainrot Party — WebSocket Protocol (Canonical)

This document is the human-readable contract for the WS protocol. The TypeScript types are the source of truth; this doc defines:
- Preconditions (when a message is valid)
- Validations (what the server must check)
- Errors (what the server may return)
- State effects (what changes)
- Broadcasts (what gets pushed)

## Conventions

### Envelope
All WS messages use:
- `{ type: string, payload: object }`

### Connection context
After `JOIN_ROOM`, the server stores in the connection context:
- `room_code` (bound room)
- `device_id`
- `is_master` (true if a valid `master_key` was provided at JOIN)
- `my_player_id` (null until the client claims a slot)

All subsequent messages are **room-bound** and do not carry `room_code`, `device_id`, or `master_key`.

### Server authority
- Server is authoritative for phase, claims, votes, scoring, and transitions.
- Clients only request actions; server may reject explicitly.

### Sync strategy
- Server pushes `STATE_SYNC_RESPONSE` on:
  - join/reconnect
  - any state mutation
  - explicit `REQUEST_SYNC`
- Master-only fields are included only if `conn.is_master=true`.

### Visibility policy
- `players_visible` is **active-only**.
- Play does not display senders; senders data is **master-only**.

---

## Message catalog

### 1) JOIN_ROOM (client → server)

**Type:** `JOIN_ROOM`  
**Payload:**
- `room_code: string`
- `device_id: string`
- `protocol_version: number`
- `master_key?: string`

**Validations**
- protocol_version supported
- room exists & not expired
- if master_key provided: must match stored master hash

**Errors**
- `invalid_protocol_version`
- `room_not_found`
- `room_expired`
- `forbidden` (invalid master_key)

**Effects**
- Bind socket to room
- Restore `my_player_id` if device already has a valid claim

**Broadcasts**
- to this socket:
  - `JOIN_OK`
  - `STATE_SYNC_RESPONSE`

---

### 2) REQUEST_SYNC (client → server)

**Type:** `REQUEST_SYNC`  
**Payload:** `{}`

**Preconditions**
- Must have completed `JOIN_ROOM`.

**Errors**
- `room_not_found` / `room_expired`

**Broadcasts**
- to this socket: `STATE_SYNC_RESPONSE`

---

### 3) TOGGLE_PLAYER (master → server)

**Type:** `TOGGLE_PLAYER`  
**Payload:** `{ player_id, active }`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"`

**Validations**
- player exists

**Errors**
- `not_master`
- `not_in_phase`
- `player_not_found`

**Effects**
- Set player active/inactive
- If set inactive and claimed:
  - release claim
  - send `SLOT_INVALIDATED(reason="disabled_or_deleted")` to that device

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 4) RESET_CLAIMS (master → server)

**Type:** `RESET_CLAIMS`  
**Payload:** `{}`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"`

**Errors**
- `not_master`
- `not_in_phase`

**Effects**
- Clear all claims (device↔player mappings)
- All players become free
- Every play socket currently owning a slot receives:
  - `SLOT_INVALIDATED(reason="reset_by_master")`

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 5) ADD_PLAYER (master → server) (NEW)

**Type:** `ADD_PLAYER`  
**Payload:** `{ name?: string }`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"`

**Validations**
- optional name length (1..24 if provided)

**Errors**
- `not_master`
- `not_in_phase`
- `invalid_payload`

**Effects**
- Create a manual player:
  - `is_sender_bound=false`
  - `sender_id=null`
  - `active=true`
  - `avatar_url=null`
- Server generates `player_id` (client never supplies ids)

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 6) DELETE_PLAYER (master → server) (NEW)

**Type:** `DELETE_PLAYER`  
**Payload:** `{ player_id }`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"`

**Validations**
- player exists
- player is manual (`is_sender_bound=false`)

**Errors**
- `not_master`
- `not_in_phase`
- `player_not_found`
- `validation_error:player_not_manual`

**Effects**
- Remove the player from room state
- If claimed:
  - release claim
  - invalidate that device: `SLOT_INVALIDATED(reason="disabled_or_deleted")`

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 7) TAKE_PLAYER (play → server)

**Type:** `TAKE_PLAYER`  
**Payload:** `{ player_id }`

**Preconditions**
- `phase="lobby"`

**Validations**
- setup is ready (setup published)
- player exists
- player active
- player not taken
- device has no current player

**Failures**
- `TAKE_PLAYER_FAIL.reason` is exactly one of:
  - `setup_not_ready`
  - `taken_now`
  - `inactive`
  - `device_already_has_player`
  - `player_not_found`

**Effects**
- Atomic claim if possible
- Set `conn.my_player_id`

**Broadcasts**
- to caller: `TAKE_PLAYER_OK`
- to room: `STATE_SYNC_RESPONSE`

---

### 8) RELEASE_PLAYER (play → server) (NEW)

**Type:** `RELEASE_PLAYER`  
**Payload:** `{}`

**Preconditions**
- `phase="lobby"`

**Validations**
- none (idempotent)

**Effects**
- If the device has a claimed slot:
  - release the claim
  - set `conn.my_player_id=null`

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 9) RENAME_PLAYER (play → server)

**Type:** `RENAME_PLAYER`  
**Payload:** `{ new_name }`

**Preconditions**
- Device has `my_player_id != null`

**Validations**
- new_name length (1..24)
- player exists
- player currently claimed by this device

**Errors**
- `not_claimed`
- `player_not_found`
- `forbidden` (claimed_by mismatch)
- `invalid_payload`

**Effects**
- Update player.name
- If player is sender-bound:
  - update sender.name to the same value (single source of truth)

**Broadcasts**
- to room: `STATE_SYNC_RESPONSE`

---

### 10) UPDATE_AVATAR (play → server)

(unchanged – lobby only, claim required)

---

## STATE_SYNC_RESPONSE shape (visibility rules)

Always present:
- `room_code`
- `phase`
- `setup_ready`
- `players_visible`
- `my_player_id`
- `scores` (if present)

Master-only:
- `players_all`
- `senders_all`
- (optional) `senders_visible` for convenience master UI

Play must not rely on any senders list.
