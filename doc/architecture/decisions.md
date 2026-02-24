# Brainrot Party — Architecture Decisions (ADR)

This file records hard decisions that must stay consistent across backend, frontend, and contracts.
If code and this doc disagree, code must be fixed or a new ADR entry must be added.

---

## ADR-001 — Monorepo structure
**Decision:** Use a single repository with npm workspaces:
- `contracts/` (shared TS types)
- `backend/` (Fastify + WS + Redis)
- `frontend/` (Vite React)

**Rationale:** Contracts-first and zero drift between client/server message types.

---

## ADR-002 — Protocol versioning
**Decision:** `protocol_version` is sent only in `JOIN_ROOM`.
Server rejects incompatible versions with `invalid_protocol_version`.

**Rationale:** Lightweight and prevents subtle client/server mismatch.

---

## ADR-003 — Authentication model (WS)
**Decision:**
- `master_key` is only sent during `JOIN_ROOM`.
- If valid, server marks the socket `is_master=true` in connection context.
- No other WS message includes `master_key`.

**Rationale:** Reduces attack surface, simplifies handlers, avoids leaking secrets in repeated payloads.

---

## ADR-004 — Client identity model (WS)
**Decision:**
- `device_id` is only sent during `JOIN_ROOM`.
- After join, `device_id` is taken from the WS connection context.
- No other WS message includes `device_id`.

**Rationale:** Prevents spoofing (client forging another device_id) and simplifies protocol.

---

## ADR-005 — Room creation transport
**Decision:** Room creation is HTTP (`POST /room`) not WS.
HTTP response returns `{ room_code, master_key }`.

**Rationale:** Room creation payload may be large (setup export) and HTTP is simpler to retry and debug.

---

## ADR-006 — State sync strategy
**Decision:** Server pushes full state via `STATE_SYNC_RESPONSE`:
- on join/reconnect
- on any state mutation
- on explicit client `REQUEST_SYNC`

**Rationale:** Eliminates delta-drift, makes reconnect robust, simplifies front-end logic in MVP.

---

## ADR-007 — Claims & uniqueness
**Decision:**
- 1 device can claim only 1 player at a time.
- 1 player can be claimed by only 1 device at a time.
- Claim is enforced atomically (Lua or equivalent).

**Rationale:** Prevents race conditions and makes lobby consistent across clients.

---

## ADR-008 — Voting rules
**Decision:**
- Votes are only accepted when `phase="game"` and `game.status="vote"`.
- `(round_id, item_id)` must match current server item.
- Player must be claimed and active.
- Exactly one vote per player per item (no changes).
- `selections.length === k`, unique, and subset of `senders_selectable`.

**Rationale:** Prevents cheating, keeps state deterministic, simplifies scoring.

---

## ADR-009 — Server-authoritative scoring
**Decision:** Scoring is computed only on server at `END_ITEM`.
Clients never compute official score.

**Rationale:** Prevents cheating and keeps results canonical.

---

## ADR-010 — Room expiration policy
**Decision:**
- Rooms are ephemeral and expire after 24 hours (TTL).
- Expired rooms are not recoverable.
- Server rejects with `room_expired` and may lazy-delete leftover keys.

**Rationale:** Keeps Redis clean and avoids ambiguous resurrection behavior.
```
