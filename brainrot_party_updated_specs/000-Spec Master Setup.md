
# Brainrot Party — Master Setup (Updated Spec)

## 1. Role of Setup
The Setup page allows the Master to:
- Import 1+ Instagram export JSON files
- Normalize & deduplicate Reel URLs (global strict dedupe)
- Build Senders (auto-merge strict)
- Manually merge / unmerge
- Activate / deactivate Senders
- Generate deterministic rounds (seed-based)
- Send final Setup to backend
- Transition to Lobby

⚠️ No DB write before final POST. All work is local draft.

---

## 2. Draft Model (Local Only)

Draft includes:
- shares
- merge_map
- active_map
- name_overrides
- seed
- k_max
- import_reports
- setup_sent_at (NEW)

### setup_sent_at (NEW)
- Set only after successful POST /room/:code/setup.
- Locks Setup UI.
- Prevents further edits while room active.

---

## 3. Final POST /room/:code/setup

### Backend Validations (Strict)

Must validate:
- room exists
- room not expired
- valid master_key
- protocol_version match
- rounds non-empty
- unique round_id
- unique item_id
- unique reel.url (strict global dedupe)
- k <= true_sender_ids.length
- round_order is exact permutation of rounds

### Error Contract (Stable)

Errors returned:
- room_not_found (404)
- room_expired (410)
- invalid_master_key (401)
- validation_error:<field>

Example:
- validation_error:round_order
- validation_error:senders
- validation_error:setup_locked

### setup_locked
If setup already sent, POST returns:
- 409
- validation_error:setup_locked

---

## 4. Setup Lock UX (NEW)

After successful upload:

- setup_sent_at stored locally
- UI enters "Setup envoyé" state
- All editing disabled:
  - imports
  - merges
  - toggles
  - seed
  - k_max
- Single CTA available:
  → "Aller au Lobby"

Re-entering Setup while room active keeps it locked.

---

## 5. Round Generation Guarantees

Generator guarantees:
- Deterministic (seed + room_code)
- Max 1 multi-sender item per round
- No sender repeated within a round
- No URL reused globally
- k always valid (1 ≤ k ≤ true_senders)

Tests exist to enforce invariants.
