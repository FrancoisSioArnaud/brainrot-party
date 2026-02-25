# 01 — Domain (Glossaire + Concepts)

Ce document définit les objets métier et le vocabulaire. Il ne contient aucune considération technique d’implémentation (sauf formats d’IDs).

## 1) Concepts principaux

### Room
Une **Room** est une partie.
- Identifiée par un `code` (RoomCode).
- Possède une `master_key` pour authentifier le Master.
- Contient un état “draft final” après Setup.

### Sender
Un **Sender** est un participant “réel” (Instagram participant_name fusionné).
- Identifié par `sender_id` stable (créé dans Setup).
- Possède un nom visible `name`.
- Peut être `active=false` (exclu des calculs et du jeu).

### Item (Reel)
Un **Item** représente une URL Reel dédupliquée globalement.
- `reel.url`
- `true_sender_ids[]` (1..N)
- `k = len(true_sender_ids)` (multi-slot)
- Un Item multi-sender apparaît **une seule fois** avec `k > 1` (pas d’item partiel)

### Round
Un **Round** est une liste ordonnée d’Items.
- Identifié par `round_id`
- Les Items sont définis à la création de room (sortie Setup)
- Invariant : dans un même round, chaque sender apparaît **au maximum une fois** dans l’union des `true_sender_ids`.
- Ordre : items triés par `len(true_sender_ids)` décroissant (multi-senders d’abord).

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
6. Invariant round : dans un même round, un sender ne peut appartenir qu’à un seul Item (aucun sender ne peut apparaître deux fois dans les `true_sender_ids` du round).
7. Ordre d’Items : à l’intérieur d’un round, les Items sont triés par `len(true_sender_ids)` décroissant (multi-senders d’abord).
8. Le serveur est la seule autorité pour :
   - validité des votes
   - calcul des scores
   - progression (item/round)

### UX Reveal
9. Le Master orchestre le reveal visuel à partir de `VOTE_RESULTS`.
10. La progression vers l’item suivant ne se fait qu’après `END_ITEM` (envoyé par le Master).

---

## 4) Vocabulaire d’état (serveur)

- `phase` : `lobby` | `game` | `over`
- `game.status` : `idle` | `vote` | `reveal`
