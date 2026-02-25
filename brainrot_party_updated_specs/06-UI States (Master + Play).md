
# UI States — Master + Play (Updated)

## MASTER FLOW

Landing → Create Room → Setup → Lobby → Game

---

## MASTER SETUP STATES

### Editing State
- Full access to imports, merges, toggles
- Preview rounds visible
- Can POST setup

### Locked State (NEW)
Triggered after successful POST setup:

- setup_sent_at exists
- Editing disabled
- UI shows "Setup envoyé"
- Single button: "Aller au Lobby"

---

## MASTER LOBBY v2 (Updated)

### Visible Data
- Room code
- WebSocket status
- Setup status badge
- Players list
- Senders list

### Player Card Shows
- Avatar (or initials fallback)
- Name
- player_id
- active toggle (master only)
- Status: free / taken
- claimed_by (device_id) visible master-only (NEW)

### Master Debug Controls
- Reset claims (NEW)
  → WS message RESET_CLAIMS
  → Clears claimed_by for all players

---

## PLAY FLOW

Landing → Enter Code → Join → Claim Player → Wait/Game

### Claim Rules
- One device_id per player
- claimed_by visible in Master Lobby
- Reset claims clears all claims

---

## ERROR UX

Frontend maps backend errors:

- room_not_found
- room_expired
- invalid_master_key
- validation_error:<field>

Displayed via clear UI error component.

---

## INVARIANTS

- Setup can only be sent once per room
- Lobby reflects real-time claims
- Round invariants enforced at generation and backend validation
