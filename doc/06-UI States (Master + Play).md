Brainrot Party — UI States
Master + Play

---

0. Landing (global)

Route
/

Contenu
- Bouton "Créer une nouvelle partie"
  → navigate("/master/setup")

- Bouton "Joindre une partie"
  → navigate("/play/enter")

Aucune logique serveur ici.

---

1. MASTER

1.1 Setup

Route
/master/setup

Au mount :
- loadDraft()
- si absent → navigate("/")

États UI :
- Import vide
- Import avec erreurs
- Fusion inactive (<2 fichiers)
- Activation avec 0 sender actif
- Ready to connect (≥2 actifs)

Boutons :
- Connecter les joueurs → POST /room → navigate("/master/lobby")
- Réinitialiser ma room → clear draft → navigate("/")

---

1.2 Lobby

Route
/master/lobby

Affiche :
- Code room
- Liste joueurs :
  - avatar
  - status (free / taken / disabled)
  - active
  - claimed_by (master only)

Bouton :
- Start Game (si ≥2 actifs)

Optionnel :
- Reset claims
- QR code

Si room invalide :
→ navigate("/")

---

1.3 Game

Route
/master/game

Flux :

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

Affiche :
- Input code
- Bouton rejoindre

Erreurs :
- room_not_found
- expired

Si succès :
→ navigate("/play/choose")

---

2.2 Choose

Route
/play/choose

Affiche :
- Liste slots joueurs
- Avatar
- Status

Si slot pris :
- message

Si SLOT_INVALIDATED :
→ retour ici

Device_id stocké localement.

---

2.3 Wait

Route
/play/wait

Affiche :
- Liste joueurs
- Message attente lancement

---

2.4 Game

Route
/play/game

États :

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

3. Règles transverses

Reconnect
- Auto reconnect si session locale existe
- Si room expired → purge session + navigate("/")

Multi-room
- Si nouveau code → reset claim local
- Ne jamais réutiliser un player_id d’une autre room

Room lifecycle
- TTL 24h
- Cleanup job
- ROOM_CLOSED / ROOM_EXPIRED gérés proprement
