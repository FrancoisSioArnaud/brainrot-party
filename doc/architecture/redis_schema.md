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
