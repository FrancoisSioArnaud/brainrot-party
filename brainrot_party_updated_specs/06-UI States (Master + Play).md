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
- Setup status badge (based on `setup_ready` from server)
- Players list (includes sender-bound + manual players)
- Senders list (master only)

### Players list rules
- Status is derived server-side: `free|taken`
- `claimed_by` (device_id) is visible **master-only**
- Players shown in Master list include:
  - sender-bound players (created from senders at setup publish)
  - manual players (added by master in lobby)

### Player Card Shows
- Avatar (or initials fallback)
- Name
- player_id
- active toggle (master only)
- Status: free / taken
- claimed_by (device_id) visible master-only

### Master Actions
- Toggle player active/inactive
- Reset claims
- Add manual player (NEW)
- Delete manual player (NEW)

#### Reset claims (WS)
- WS message: `RESET_CLAIMS`
- Effect:
  - clears all claims
  - all players become `free`
  - all play clients with a slot get `SLOT_INVALIDATED(reason="reset_by_master")`

#### Add manual player (WS) (NEW)
- WS message: `ADD_PLAYER`
- Creates a new player with:
  - `is_sender_bound=false`
  - `sender_id=null`
  - `active=true`
  - `name` = provided (or default "Player")
  - `avatar_url=null`
- Server generates `player_id` (never provided by client)

#### Delete manual player (WS) (NEW)
- WS message: `DELETE_PLAYER { player_id }`
- Constraints:
  - only manual players (`is_sender_bound=false`)
  - lobby only
- If the player is currently claimed:
  - claim is released
  - the claiming device receives `SLOT_INVALIDATED(reason="disabled_or_deleted")`

---

## PLAY FLOW

Landing → Enter Code → Join → Claim Player → Wait/Game

### Play Visible Data (IMPORTANT)
- Play sees **only players** (no senders list).
- Play receives:
  - `players_visible` (active-only)
  - `my_player_id`
  - phase + setup_ready
- Play does not display senders.

### Claim Rules
- One device_id per player
- One player per device_id
- Reset claims clears all claims

### Change player (NEW)
- While `phase="lobby"`, a claimed Play user can click "Changer de joueur":
  - sends `RELEASE_PLAYER`
  - releases the claim
  - returns to the list of available players

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

- Setup can only be sent once per room (backend lock)
- Lobby reflects real-time claims (server authoritative)
- A device controls at most one player
- A player is claimed by at most one device
- Manual players are server-generated IDs, lobby-only mutations
- Play does not depend on any sender list visibility
