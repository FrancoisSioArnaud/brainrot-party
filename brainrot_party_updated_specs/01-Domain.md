# 01 — Domain (Glossaire + Concepts)

Ce document définit les objets métier et le vocabulaire. Il ne contient aucune considération technique d’implémentation (sauf formats d’IDs).

## 1) Concepts principaux

### Room
Une **Room** est une partie.
- Identifiée par un `code` (RoomCode).
- Possède une `master_key` pour authentifier le Master.
- Contient un état “final” après publication du Setup.
- Le Setup est **verrouillé** (une seule publication possible).

### Sender
Un **Sender** est un participant “réel” (Instagram participant_name fusionné).
- Identifié par `sender_id` stable (créé dans Setup).
- Possède un nom visible `name`.
- Peut être `active=false` (exclu des calculs et du jeu).

### Player
Un **Player** est un slot jouable dans le Lobby.

Deux catégories :

#### Player sender-bound
- Représente directement un Sender.
- Champs :
  - `is_sender_bound=true`
  - `sender_id` présent
- Règle de nom :
  - le `name` du player et le `name` du sender sont une seule source de vérité :
  - si le player renommé (par le device qui l’a claim), le sender est renommé identiquement.

#### Player manuel (NEW)
- Slot ajouté par le Master en Lobby, non lié à un Sender.
- Champs :
  - `is_sender_bound=false`
  - `sender_id=null`
- Identité :
  - `player_id` est généré côté serveur (jamais fourni par le client)
- Impact jeu :
  - participe comme n’importe quel player (claim, vote, score)

### Item (Reel)
Un **Item** représente une URL Reel dédupliquée globalement.
- `reel.url`
- `true_sender_ids[]` (1..N)
- `k = len(true_sender_ids)`
- Un Item multi-sender apparaît **une seule fois** avec `k > 1` (pas d’item partiel)

### Round
Un **Round** est une liste ordonnée d’Items.
- Identifié par `round_id`
- Les Items sont définis à la publication du Setup
- Invariant : dans un même round, chaque sender apparaît **au maximum une fois** dans l’union des `true_sender_ids`.
- Ordre : items triés par `len(true_sender_ids)` décroissant (multi-senders d’abord).

### Vote
Un **Vote** est l’action d’un Player pendant un Item.
- Un Player soumet `selections[]` (liste de `sender_id`)
- Contrainte : `len(selections) <= k` (l’UX force typiquement `== k`)
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
- `player_id` :
  - sender-bound : string stable dérivé (ou généré serveur)
  - manuel : string généré serveur (ex: "p_manual_<uuid>")
- `round_id` : string (ex: "r1")
- `item_id` : string (ex: "i1")
- `reel_id` : string (ex: "reel_abc" ou hash de l’URL)

---

## 3) Invariants (règles qui doivent toujours être vraies)

### Setup
1. Une room ne peut recevoir qu’un seul setup (setup lock strict côté backend).
2. Les URLs (`reel.url`) sont uniques dans tout le setup.

### Lobby
3. Un Player `active=false` est `disabled` et invisible côté Play.
4. Un Player `taken` a obligatoirement un claim `player_id -> device_id`.
5. Un `device_id` ne possède qu’un seul `player_id` (claim unique par device).
6. Un Player manuel a toujours `is_sender_bound=false` et `sender_id=null`.
7. Un Player sender-bound a toujours `is_sender_bound=true` et `sender_id` présent.
8. Rename sender-bound : renommer le player renomme le sender (même valeur).

### Game
9. Chaque Item est joué une seule fois.
10. `k = len(true_sender_ids)` et `k >= 1`.
11. Invariant round : dans un même round, un sender ne peut appartenir qu’à un seul Item.
12. Ordre d’Items : `len(true_sender_ids)` décroissant à l’intérieur d’un round.
13. Le serveur est la seule autorité pour validité vote / scoring / progression.

### UX Reveal
14. Le Master orchestre le reveal visuel à partir de `VOTE_RESULTS`.
15. La progression vers l’item suivant ne se fait qu’après `END_ITEM` (envoyé par le Master).

---

## 4) Vocabulaire d’état (serveur)

- `phase` : `lobby` | `game` | `over`
- `game.status` : `idle` | `vote` | `reveal_wait` | `round_recap`
