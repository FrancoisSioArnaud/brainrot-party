# 06 — UI States (Master + Play) — v3 (aligné protocole WS + Redis + Setup v2)

Objectif : figer les **écrans**, **états UI**, **transitions**, et **réactions aux messages WS**.
Sans logique “optionnelle”. Tout est requis.

---

## 1) Master — États UI (par page)

### 1.1 `/master/setup` — Setup
**State UI**
- `draft_loaded` | `parsing` | `ready` | `create_room_pending` | `create_room_error`

**Entrées**
- Arrivée sur page :
  - charger `localStorage.brp_draft_v1`
  - si absent → redirect `/master`
- Actions import/suppression fichier :
  - `parsing` pendant rebuild complet
- Bouton “Connecter les joueurs” :
  - enabled si `files.length>=1` et `activeSendersCount>=2`

**CREATE_ROOM**
- Click “Connecter les joueurs” :
  1) build payload minimal `{senders_active, rounds_generated, round_order}`
  2) WS `CREATE_ROOM`
  3) UI → `create_room_pending`

**Réponses WS**
- `ROOM_CREATED` :
  - stocker `draft.server_room = {code, master_key}` dans localStorage
  - navigate `/master/lobby`
- `ERROR` :
  - UI → `create_room_error`
  - afficher message (snackbar)

**Reset room**
- Click “Réinitialiser ma room” :
  - si `draft.server_room` existe :
    - WS `ROOM_CLOSED {code, master_key}`
  - clear localStorage
  - navigate `/master`

---

### 1.2 `/master/lobby` — Lobby Master
**State UI**
- `boot` | `syncing` | `ready` | `start_pending` | `error`

**Boot**
- Lire `draft.server_room {code, master_key}` depuis localStorage
- Si absent → redirect `/master/setup`

**Sync**
- Envoyer `STATE_SYNC {code, device_id, master_key}`
- UI → `syncing`

**Réponses WS**
- `STATE_SYNC_RESPONSE` (master_key valide) :
  - `players_visible` + `players_all`
  - `senders_visible` + `senders_all`
  - `phase`
  - UI → `ready`
  - si `phase == game` → navigate `/master/game`
  - si `phase == over` → navigate `/master/game` (écran résultats)
- `ERROR room_not_found|room_expired` :
  - afficher message
  - supprimer `draft.server_room` (room morte)
  - navigate `/master/setup`

**Lobby interactions**
- Toggle player actif/inactif (sur card master) :
  - WS `TOGGLE_PLAYER {code, master_key, player_id, active}`
  - UI reste `ready` (optimistic possible)
- Start game :
  - enabled si :
    - `count(active players) >= 2`
    - tous les players actifs sont `taken`
  - click → WS `START_GAME {code, master_key}`
  - UI → `start_pending`

**Messages WS temps réel**
- `PLAYER_UPDATE` :
  - update card correspondante (name/avatar/status)
  - si `sender_updated` : update sender name dans la UI
- `SLOT_INVALIDATED` (peu probable côté master) :
  - update UI via resync (ou update claim/local state)
- `GAME_START` :
  - UI peut afficher “Game started”
- `NEW_ITEM` :
  - navigate `/master/game` (ou attendre `GAME_START` déjà reçu)
- `ROOM_CLOSED_BROADCAST` :
  - clear `draft.server_room`
  - navigate `/master/setup`

---

### 1.3 `/master/game` — Game Master
**State UI**
- `boot` | `syncing` | `idle_item` | `vote_open` | `reveal_animating` | `round_recap` | `game_over` | `error`

**Boot**
- Lire `draft.server_room {code, master_key}`
- Si absent → redirect `/master/setup`

**Sync**
- WS `STATE_SYNC {code, device_id, master_key}`
- UI → `syncing`

**Réponses WS**
- `STATE_SYNC_RESPONSE` :
  - si `phase == lobby` → navigate `/master/lobby`
  - si `phase == over` → UI → `game_over` (ranking)
  - si `phase == game` :
    - selon `game.status` :
      - `idle` → `idle_item` (afficher item courant)
      - `vote` → `vote_open` (afficher “votes reçus”)
      - `reveal_wait` → `reveal_animating` (reveal se joue côté master, mais on resync les résultats)
      - `round_recap` → `round_recap` (afficher recap)
- `ERROR room_not_found|room_expired` :
  - clear `draft.server_room`
  - navigate `/master/setup`

**Déroulé item**
1) `idle_item`
   - UI montre reel focus + bouton “Ouvrir”
   - click “Ouvrir” :
     - ouvre URL Instagram (nouvel onglet)
     - WS `REEL_OPENED {code, master_key, round_id, item_id}`
     - UI → `vote_open`
2) `vote_open`
   - UI affiche :
     - indicateur “votes reçus” (à partir de `game.votes_received_player_ids` via STATE_SYNC, et `PLAYER_VOTED`)
   - WS reçu :
     - `PLAYER_VOTED` → update indicator
     - `VOTE_RESULTS` → stocker results local → lancer reveal UI
       - UI → `reveal_animating`
3) `reveal_animating`
   - La séquence reveal (6 étapes) est 100% **côté Master**.
   - À la fin de l’animation :
     - WS `END_ITEM {code, master_key, round_id, item_id}`
4) Réponses fin item
   - si serveur pousse `NEW_ITEM` :
     - UI → `idle_item` (nouvel item)
   - si serveur pousse `ROUND_RECAP` :
     - UI → `round_recap`

**Fin de round**
- `round_recap`
  - UI affiche :
    - points gagnés sur le round par player (round_delta)
    - score total
  - bouton “Next round”
    - WS `START_NEXT_ROUND {code, master_key}`
- Réponses :
  - `NEW_ITEM` → `idle_item`
  - `GAME_OVER` → `game_over`

**ROOM_CLOSED**
- Si master ferme la room depuis UI (si tu ajoutes un bouton) :
  - WS `ROOM_CLOSED {code, master_key}`
- WS `ROOM_CLOSED_BROADCAST` :
  - clear `draft.server_room`
  - navigate `/master/setup`

---

## 2) Play — États UI (par page)

### 2.1 `/play/enter` — Enter code
**State UI**
- `idle` | `join_pending` | `join_error`

**Flow**
- Saisie code
- Submit → WS `JOIN_ROOM {code, device_id}`
- UI → `join_pending`

**Réponses WS**
- `JOIN_OK` :
  - stocker `play_session = {code, device_id}` (localStorage)
  - navigate `/play/choose`
- `ERROR room_not_found|room_expired` :
  - UI → `join_error` + message

---

### 2.2 `/play/choose` — Choose player
**State UI**
- `boot` | `syncing` | `ready` | `take_pending` | `take_error`

**Boot**
- charger `play_session {code, device_id}`
- si absent → navigate `/play/enter`

**Sync**
- WS `STATE_SYNC {code, device_id}`
- UI → `syncing`

**Réponses WS**
- `STATE_SYNC_RESPONSE` :
  - si `phase == lobby` :
    - afficher `players_visible`
    - si `my_player_id != null` → navigate `/play/wait`
    - sinon UI → `ready`
  - si `phase == game` :
    - si `my_player_id == null` → rester sur choose avec message “choisis un player” (mais normalement impossible si start bloqué)
    - sinon navigate `/play/game`
  - si `phase == over` :
    - navigate `/play/game` (écran résultats)
- `ERROR room_not_found|room_expired` :
  - clear play_session
  - navigate `/play/enter`

**Take player**
- click sur player `free`
  - WS `TAKE_PLAYER {code, player_id, device_id}`
  - UI → `take_pending`
- `TAKE_PLAYER_OK` :
  - navigate `/play/wait`
- `TAKE_PLAYER_FAIL {taken_now}` :
  - UI → `take_error` + message “Pris à l’instant”
  - refresh list (STATE_SYNC)
- `PLAYER_UPDATE` :
  - update list (status free/taken)

---

### 2.3 `/play/wait` — Lobby wait + edit profile
**State UI**
- `boot` | `syncing` | `ready` | `edit_pending`

**Boot**
- require play_session
- WS `STATE_SYNC {code, device_id}` → `syncing`

**Réponses WS**
- `STATE_SYNC_RESPONSE` :
  - si `phase == lobby` :
    - si `my_player_id == null` → navigate `/play/choose` + message “Ton player n’est plus dispo”
    - sinon UI → `ready` (affiche nom/avatar)
  - si `phase == game` :
    - navigate `/play/game`
  - si `phase == over` :
    - navigate `/play/game`
- `SLOT_INVALIDATED` :
  - navigate `/play/choose` + message explicite
- `PLAYER_UPDATE` :
  - update affichage (nom/avatar)

**Actions**
- Modifier mon nom :
  - WS `RENAME_PLAYER {code, player_id, device_id, new_name}`
- Ajouter photo (camera) :
  - crop/resize **300x300** côté client
  - WS `UPDATE_AVATAR {code, player_id, device_id, image:dataURL}`
- Changer de player :
  - navigate `/play/choose`
  - (pas de “release” explicite : le claim reste tant que player actif; si tu veux libérer il faut ajouter un message, mais non prévu ici)

---

### 2.4 `/play/game` — Vote
**State UI**
- `boot` | `syncing` | `idle` | `vote` | `vote_sent` | `round_finished` | `game_over`

**Boot**
- WS `STATE_SYNC {code, device_id}`

**Réponses WS**
- `STATE_SYNC_RESPONSE` :
  - si `phase == lobby` → navigate `/play/wait`
  - si `phase == game` :
    - si `my_player_id == null` → navigate `/play/choose`
    - sinon :
      - si `game.status == vote` → `vote` (si item match)
      - sinon → `idle`
  - si `phase == over` → `game_over`

**Déclenchement vote**
- WS `START_VOTE {round_id,item_id,k,senders_selectable}`
  - UI → `vote`
  - reset sélection
  - affichage grille senders_selectable
  - règle : sélection max = k, bouton Voter actif seulement si sélection == k

**Submit**
- click “Voter” :
  - WS `SUBMIT_VOTE {code,round_id,item_id,player_id:my_player_id,device_id,selections}`
  - UI → `vote_sent`
- `VOTE_ACK {accepted:true}` :
  - rester `vote_sent` (“vote envoyé”)
- `VOTE_ACK {accepted:false}` :
  - UI → `vote` + message raison
- `NEW_ITEM` :
  - UI → `idle` (nouvel item affiché en attente de START_VOTE)
- `ROUND_FINISHED` :
  - UI → `round_finished` (attente next round)
- `GAME_OVER` :
  - UI → `game_over`
- `ROOM_CLOSED_BROADCAST` :
  - clear play_session
  - navigate `/play/enter`

---

## 3) Règles UI transverses

### 3.1 device_id
- Généré une fois côté Play (uuid) et stocké en localStorage.
- Reutilisé pour JOIN/STATE_SYNC/TAKE/RENAME/AVATAR/VOTE.

### 3.2 Resync systématique
- Toute incohérence UI (ex: player disparu, vote late) → lancer `STATE_SYNC`.
- Après refresh navigateur : toujours `STATE_SYNC` pour retrouver l’état.

### 3.3 Persistences locales
- Master :
  - `brp_draft_v1` contient `server_room {code, master_key}`
- Play :
  - `brp_play_session_v1` contient `{code, device_id}`

---
