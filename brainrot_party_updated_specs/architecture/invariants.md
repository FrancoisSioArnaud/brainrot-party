# Brainrot Party — Redis Schema (Canonical)

Redis is the authoritative storage for ephemeral rooms (lobby/game).

## TTL policy
- Room TTL: implementation-defined (must produce `room_expired` reliably).
- Expiration behavior: once expired, all actions must reject with `room_expired`.

---

## Keys per room (conceptual)

### Room meta
Stores:
- room_code, created_at, expires_at
- master hash
- protocol version

### Room state (authoritative)
Single JSON state drives `STATE_SYNC_RESPONSE`.

---

## State building for clients

### players_visible
Derived from authoritative state:
- **active-only**
- `status` computed server-side:
  - `taken` if a claim exists
  - else `free`

### senders visibility
- Play does **not** rely on senders list.
- senders lists are **master-only** (master UI / debug).

### my_player_id
Derived from device_id claim mapping:
- device -> player mapping
- validated against current room players

---

## Atomic operations (Lua recommended)

### Claim player (TAKE_PLAYER)
Goal:
- prevent two devices claiming the same player
- prevent one device claiming multiple players
- validate active flag
- reject if setup not ready

Reasons (contract):
- `setup_not_ready`
- `device_already_has_player`
- `taken_now`
- `inactive`
- `player_not_found`

### Release player (RELEASE_PLAYER)
- release device->player and player->device maps
- idempotent

---

## Manual players (NEW)
Master-only, lobby-only mutations:
- add manual player (server-generated player_id)
- delete manual player
