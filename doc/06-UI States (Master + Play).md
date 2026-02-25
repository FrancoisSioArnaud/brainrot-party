Brainrot Party — UI States
Master + Play (v3)

---

0. Landing (global)

Route
/

Contenu
- Bouton "Créer une nouvelle partie"
  Flow :
  1) POST /room
  2) save session master { room_code, master_key } (localStorage.brp_master_v1)
  3) navigate("/master/setup")

- Bouton "Joindre une partie"
  → navigate("/play/enter")

Optionnel (UX) :
- Si un message d’erreur existe (ex: "Room expiré"), afficher un bandeau/snackbar.

---

1. MASTER

1.1 Setup

Route
/master/setup

Au mount (garde)
- Si session master absente (pas de brp_master_v1) :
  → navigate("/")

- Sinon :
  - Créer ou charger le draft local associé au room_code
  - Si draft corrompu :
    → rester sur Setup
    → afficher erreur "Draft corrompu" + CTA "Réinitialiser le draft"

Erreurs backend
- Si un call requis renvoie room_expired / room_not_found :
  → clear session master + clear draft lié
  → navigate("/") avec message "Room expiré"

États UI
- Import vide
- Import avec erreurs
- Fusion inactive (<2 fichiers)
- Activation avec 0 sender actif
- Ready to connect (≥2 actifs)

Boutons
- Connecter les joueurs
  → POST /room/:code/setup (header x-master-key)
  → si OK : navigate("/master/lobby")
  → si validation_error : rester Setup + message

- Réinitialiser le draft
  → clear draft
  → rester Setup (état vide)

---

1.2 Lobby

Route
/master/lobby

Pré-requis
- Session master présente (room_code + master_key)
- Room existante et non expirée

Connexion WS (master-only)
- Ouvrir WS et envoyer JOIN_ROOM avec :
  - room_code
  - device_id = "master_device" (ou un device_id dédié)
  - protocol_version
  - master_key (depuis brp_master_v1)
- Si master_key valide :
  - conn.is_master=true
  - STATE_SYNC_RESPONSE peut inclure des champs master-only

Affiche
- Code room
- Liste joueurs :
  - avatar
  - status (free / taken / disabled)
  - active
  - claimed_by (master only)

Bouton
- Start Game (si ≥2 actifs)

Si room invalide (expired/not found)
→ clear session master + clear draft lié
→ navigate("/") + message "Room expiré"

---

1.3 Game

Route
/master/game

Flux minimal
START_GAME
NEW_ITEM
START_VOTE
VoteResults
RoundRecap
NextRound
GameOver

Le backend est source de vérité.
Le client ne calcule aucun score.

---

2. PLAY

2.1 Enter

Route
/play/enter

Affiche
- Input code
- Bouton rejoindre

Connexion WS (play)
- Ouvrir WS et envoyer JOIN_ROOM avec :
  - room_code
  - device_id (local)
  - protocol_version
- Ne jamais envoyer master_key côté Play.

Règle multi-room (obligatoire)
- Lorsqu’un utilisateur entre un code :
  - si une session Play existe (localStorage.brp_play_v1.room_code)
  - ET que le code entré est différent :
    → supprimer la session Play précédente (clear brp_play_v1)
    → générer un nouveau device_id
    → continuer le join avec la nouvelle session

Erreurs
- room_not_found
- expired
Dans ces cas : afficher message, rester sur /play/enter

Si succès
→ navigate("/play/choose")

---

2.2 Choose

Route
/play/choose

Affiche
- Liste slots joueurs
- Avatar
- Status

Si slot pris : message
Si SLOT_INVALIDATED : retour ici

Device_id stocké localement.

---

2.3 Wait

Route
/play/wait

Affiche
- Liste joueurs
- Message attente lancement

---

2.4 Game

Route
/play/game

États
NEW_ITEM
- lien reel
- bouton Ready

START_VOTE
- multi-select (k max)
- SUBMIT_VOTE
- VOTE_ACK

VoteResults
- reveal
- points

RoundRecap
- scores

GameOver
- ranking final

Aucun calcul côté client.
Votes validés serveur.

---

3. Règles transverses (MVP)

Reconnect Play
- Auto reconnect si session locale existe
- Si room expired → purge session + retour /play/enter
