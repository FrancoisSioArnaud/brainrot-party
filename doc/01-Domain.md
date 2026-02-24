# 01 — Domain (Glossaire + Concepts)

Ce document définit les objets métier et le vocabulaire. Il ne contient aucune considération technique d’implémentation (sauf formats d’IDs).

## 1) Concepts principaux

### Room
Une **Room** représente une partie (Lobby + Game) identifiée par un `code` unique.
- Durée de vie : **12 heures** (expiration automatique)
- Source de vérité : serveur
- États : `lobby` → `game` → `over`

### Master
Le **Master** pilote la partie sur desktop.
- Crée la room (via sortie du Setup)
- Gère les Players (toggle)
- Démarre la partie
- Ordonne la **révélation visuelle** (animation), mais ne calcule pas les scores.

### Play (client mobile)
Un **Play** est un client mobile identifié par un `device_id`.
- Rejoint une room via `code`
- Prend un Player (slot)
- Vote pendant la partie
- Peut renommer / ajouter une photo sur son Player

### Sender
Un **Sender** est une entité “personne” issue des exports Instagram.
- Identifiée par `sender_id`
- Attributs : `name`, `active`, `reels_count`
- Les Senders inactifs ne participent pas au jeu
- Chaque Sender actif génère un Player “lié” (sender-bound)

### Player
Un **Player** est un slot jouable dans la room.
- Identifié par `player_id`
- 1 Player est créé par Sender actif (sender-bound)
- Propriétés publiques : `name`, `avatar_url`, `active`, `status`

Statut `status` :
- `free` : non pris
- `taken` : pris par un device_id (claim)
- `disabled` : inactif (non visible côté Play)

### Claim
Un **Claim** relie un `player_id` à un `device_id`.
- Un seul device_id par player
- Un device_id ne doit posséder qu’un seul player à la fois (invariant)
- Prise atomique pour éviter les collisions

### Reel
Un **Reel** est une URL Instagram.
- Identifiée par `reel_id` (ou un hash dérivé)
- Attribut : `url`

### Item
Un **Item** correspond à **un Reel joué une seule fois** dans un round.
- Contient :
  - `reel`
  - `true_sender_ids[]` (1..N)
  - `k = len(true_sender_ids)` (multi-slot)
- Un Item multi-sender apparaît **une seule fois** avec `k > 1` (pas d’item partiel)

### Round
Un **Round** est une liste ordonnée d’Items.
- Identifié par `round_id`
- Les Items sont définis à la création de room (sortie Setup)

### Vote
Un **Vote** est l’action d’un Player pendant un Item.
- Un Player soumet `selections[]` (liste de `sender_id`)
- Contrainte : `len(selections) <= k` (et l’UX force typiquement `== k`)
- Le serveur valide et calcule les points

### Score
Le **Score** est cumulatif sur la partie.
- +1 point par sender correctement sélectionné
- Aucun malus

On distingue :
- `score_total` : cumul global
- `points_round` : delta du round courant (pour recap)

---

## 2) Identifiants & formats

- `code` (RoomCode) : string (ex: "L4YX6W4K")
- `device_id` : UUID string stocké en localStorage côté Play
- `sender_id` : string stable produit par Setup
- `player_id` : string stable produit par serveur (ou dérivé sender)
- `round_id` : string (ex: "r1")
- `item_id` : string (ex: "i1")
- `reel_id` : string (ex: "reel_abc" ou hash de l’URL)

---

## 3) Invariants (règles qui doivent toujours être vraies)

### Lobby
1. Un Player `active=false` est `disabled` et invisible côté Play.
2. Un Player `taken` a obligatoirement un claim `player_id -> device_id`.
3. Un `device_id` ne possède qu’un seul `player_id` (claim unique par device).

### Game
4. Chaque Item est joué une seule fois.
5. `k = len(true_sender_ids)` et `k >= 1`.
6. Le serveur est la seule autorité pour :
   - validité des votes
   - calcul des scores
   - progression (item/round)

### UX Reveal
7. Le Master orchestre le reveal visuel à partir de `VOTE_RESULTS`.
8. La progression vers l’item suivant ne se fait qu’après `END_ITEM` (envoyé par le Master).

---

## 4) Vocabulaire d’état (serveur)

- `phase` : `lobby` | `game` | `over`
- `game.status` : `idle` | `vote` | `reveal_wait`

Définitions :
- `idle` : item affiché, vote non ouvert
- `vote` : vote ouvert aux Plays
- `reveal_wait` : vote clos, résultats calculés, reveal en cours côté Master
