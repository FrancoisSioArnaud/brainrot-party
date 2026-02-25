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

Master-only fields are included only if `conn.is_master=true`.

---

## Message catalog

### 1) JOIN_ROOM (client → server)

**Type:** `JOIN_ROOM`  
**Payload:**
- `room_code: string`
- `device_id: string`
- `protocol_version: number`
- `master_key?: string`

**Preconditions**
- None (this is the entry point).

**Validations**
- `protocol_version` equals server `PROTOCOL_VERSION`.
- `room_code` exists and is not expired.
- If `master_key` provided:
  - validate against stored master hash.

**Errors**
- `invalid_protocol_version`
- `room_not_found`
- `room_expired`
- `forbidden` (if master_key present but invalid)

**State effects**
- Bind socket to `room_code`.
- Store `device_id` and `is_master` in connection context.
- If the room has an existing claim mapping for this `device_id`:
  - set `my_player_id` accordingly (if still valid).

**Broadcasts**
- To this socket immediately:
  - `JOIN_OK`
  - `STATE_SYNC_RESPONSE` (full state, master-only fields if `is_master=true`)

---

### 2) REQUEST_SYNC (client → server)

**Type:** `REQUEST_SYNC`  
**Payload:** `{}`

**Preconditions**
- Must have completed `JOIN_ROOM`.

**Validations**
- Connection is bound to a room.

**Errors**
- `room_not_found` / `room_expired` (if room disappeared between join and request)
- `invalid_state` / `forbidden` not expected; prefer `room_*` errors.

**State effects**
- None.

**Broadcasts**
- To this socket:
  - `STATE_SYNC_RESPONSE` (full)

---

### 3) TOGGLE_PLAYER (master → server)

**Type:** `TOGGLE_PLAYER`  
**Payload:** `{ player_id, active }`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"` (recommended; if you allow toggling mid-game, document it explicitly—default is lobby-only)

**Validations**
- `player_id` exists
- `active` boolean

**Errors**
- `not_master`
- `not_in_phase`
- `player_not_found`

**State effects**
- Set player active/inactive.
- If toggled to inactive and currently claimed:
  - invalidate claim (server-side), clear `claimed_by` and any device→player mapping.

**Broadcasts**
- To all room sockets:
  - `PLAYER_UPDATE` (optional convenience)
  - `SLOT_INVALIDATED` to the device that lost the slot (if applicable)
  - `STATE_SYNC_RESPONSE` (full)

---

### 4) TAKE_PLAYER (play → server)

**Type:** `TAKE_PLAYER`  
**Payload:** `{ player_id }`

**Preconditions**
- `phase="lobby"`
- Client has joined the room.

**Validations**
- `player_id` exists
- player is `active=true`
- player is not already taken
- device does not already have a claimed player

**Errors**
- `not_in_phase`
- `player_not_found`
- `player_inactive`
- `player_taken`
- `conflict` (generic fallback)

**State effects**
- Atomically set claim:
  - `player.claimed_by = conn.device_id`
  - `conn.my_player_id = player_id`
  - update device→player mapping

**Broadcasts**
- To the requesting socket:
  - `TAKE_PLAYER_OK` (with `my_player_id`)
- To all room sockets:
  - `PLAYER_UPDATE` (optional convenience)
  - `STATE_SYNC_RESPONSE` (full)
- If claim fails due to race:
  - send `TAKE_PLAYER_FAIL`

---

### 5) RENAME_PLAYER (play → server)

**Type:** `RENAME_PLAYER`  
**Payload:** `{ new_name }`

**Preconditions**
- Client has `my_player_id != null` (claimed)

**Validations**
- `new_name` trimmed length constraints (define: e.g. 1..20)
- player exists and is currently claimed by this device

**Errors**
- `not_claimed`
- `player_not_found`
- `forbidden` (if claimed_by mismatch)
- `invalid_payload`

**State effects**
- Update player name.

**Broadcasts**
- To all room sockets:
  - `PLAYER_UPDATE` (optional)
  - `STATE_SYNC_RESPONSE` (full)

---

### 6) UPDATE_AVATAR (play → server)

**Type:** `UPDATE_AVATAR`  
**Payload:** `{ image }`

**Preconditions**
- Client has `my_player_id != null`

**Validations**
- Size limits (must be defined): max bytes, allowed prefix (`data:image/...`)
- Optional: server-side resize/compress

**Errors**
- `not_claimed`
- `invalid_payload`
- `forbidden`

**State effects**
- Store avatar (either:
  - direct data URL in state (not recommended), or
  - upload to object storage and store URL (recommended))
- Update `avatar_url`

**Broadcasts**
- To all room sockets:
  - `PLAYER_UPDATE` (optional)
  - `STATE_SYNC_RESPONSE` (full)

---

### 7) START_GAME (master → server)

**Type:** `START_GAME`  
**Payload:** `{}`

**Preconditions**
- `conn.is_master=true`
- `phase="lobby"`

**Validations**
- Minimum number of active players (define: e.g. ≥2)
- At least one playable sender/item exists (from setup payload persisted in room)

**Errors**
- `not_master`
- `not_in_phase`
- `conflict` (e.g. not enough players)
- `invalid_state`

**State effects**
- Set `phase="game"`
- Initialize game state:
  - `status="idle"`
  - `current_round_id`, `current_item_index`
  - prepare first item

**Broadcasts**
- To all room sockets:
  - `GAME_START`
  - `NEW_ITEM` (or via `STATE_SYNC_RESPONSE`)
  - `STATE_SYNC_RESPONSE` (full)

---

### 8) REEL_OPENED (master → server)

**Type:** `REEL_OPENED`  
**Payload:** `{ round_id, item_id }`

**Preconditions**
- `conn.is_master=true`
- `phase="game"`
- Current item matches `(round_id,item_id)`

**Validations**
- Round and item are current
- Game status allows transition to vote (typically from `idle`)

**Errors**
- `not_master`
- `not_in_phase`
- `invalid_state`
- `conflict` / `invalid_payload` (mismatch)

**State effects**
- Transition to `status="vote"`
- Initialize vote tracking for the item:
  - clear previous vote receipts
  - start collecting votes
- Master-only:
  - reset `votes_received_player_ids`

**Broadcasts**
- To all room sockets:
  - `START_VOTE`
  - `STATE_SYNC_RESPONSE` (full; master sees `votes_received_player_ids`)

---

### 9) SUBMIT_VOTE (play → server)

**Type:** `SUBMIT_VOTE`  
**Payload:** `{ round_id, item_id, selections: SenderId[] }`

**Preconditions**
- `phase="game"`
- `game.status="vote"`
- Client is claimed (`my_player_id != null`)
- Current item matches `(round_id,item_id)`

**Validations**
- `selections.length === k`
- Unique selections (no duplicates)
- Each selection is in `senders_selectable`
- Optional: player must be expected voter (active, not disabled mid-vote)

**Errors**
- `not_in_phase`
- `not_claimed`
- `vote_closed` (if status not vote or already ended)
- `already_voted`
- `invalid_payload` (bad list)
- `forbidden` (if player inactive)

**State effects**
- Store vote for `my_player_id`
- Append `my_player_id` to `votes_received_player_ids` (master-only tracking)

**Broadcasts**
- To the voting socket:
  - `VOTE_ACK` (`accepted=true/false` + reason)
- To all room sockets (optional but useful):
  - `PLAYER_VOTED` (indicates who voted, can be hidden on play if you want)
- To all room sockets:
  - `STATE_SYNC_RESPONSE` (full; master sees updated receipts)

---

### 10) END_ITEM (master → server)

**Type:** `END_ITEM`  
**Payload:** `{ round_id, item_id }`

**Preconditions**
- `conn.is_master=true`
- `phase="game"`
- Current item matches `(round_id,item_id)`

**Validations**
- status is `vote` (or allow `reveal_wait` only if idempotent)
- votes are closed after this point (server-level)

**Errors**
- `not_master`
- `not_in_phase`
- `invalid_state`
- `conflict`

**State effects**
- Close voting
- Compute results and scoring
- Set `status="reveal_wait"`
- Populate master-only `current_vote_results` in state sync

**Broadcasts**
- To all room sockets:
  - `VOTE_RESULTS` (public results as designed)
  - `STATE_SYNC_RESPONSE` (full; master also sees `current_vote_results`)

---

### 11) START_NEXT_ROUND (master → server)

**Type:** `START_NEXT_ROUND`  
**Payload:** `{}`

**Preconditions**
- `conn.is_master=true`
- `phase="game"`
- status is `round_recap` OR end-of-round state (depending on your flow)

**Validations**
- There is a next round or next item.
- Game progression rules satisfied.

**Errors**
- `not_master`
- `not_in_phase`
- `invalid_state`
- `conflict`

**State effects**
- Advance:
  - next item (same round), OR
  - next round (reset item index)
- Set status back to `idle`
- Prepare next `NEW_ITEM`

**Broadcasts**
- To all room sockets:
  - `ROUND_FINISHED` (if round ended)
  - `NEW_ITEM`
  - `STATE_SYNC_RESPONSE` (full)

---

### 12) ROOM_CLOSED (master → server)

**Type:** `ROOM_CLOSED`  
**Payload:** `{}`

**Preconditions**
- `conn.is_master=true`

**Validations**
- None (idempotent is fine)

**Errors**
- `not_master`

**State effects**
- Mark room closed (optional) and/or delete from Redis.

**Broadcasts**
- To all room sockets:
  - `ROOM_CLOSED_BROADCAST`
- Then server disconnects sockets (recommended)

---

## Server → Client pushes (summary)

### STATE_SYNC_RESPONSE
- Always includes: `room_code`, `phase`, `players_visible`, `senders_visible`, `my_player_id`, `game`, `scores`
- Includes master-only when `conn.is_master=true`:
  - `players_all`, `senders_all`
  - if `game.status="vote"`: `votes_received_player_ids`
  - if `game.status="reveal_wait"`: `current_vote_results`

### GAME_OVER
- Sent when phase transitions to `game_over`
- Includes ranking + final scores
