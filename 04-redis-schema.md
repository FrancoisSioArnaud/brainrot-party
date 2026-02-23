
# 04 — Redis Schema (Clés + JSON + TTL)

Objectif : décrire précisément ce qui est stocké dans Redis, sous quelles clés, et comment c’est mis à jour.
Persistance : **Redis uniquement**, TTL fixé à la création : **12 heures** (43200s), pas de refresh.

Préfixe standard :
- `room:{code}:...`

---

## 0) Conventions

### TTL
- Chaque clé de la room reçoit `EXPIRE 43200` au moment de la création.
- Toute suppression “manuelle” (ROOM_CLOSED) supprime toutes les clés `room:{code}:*`.

### Types Redis
- `STRING(JSON)` : une string contenant du JSON sérialisé
- `HASH` : hash Redis (fields → values)

### Visibilité
- On stocke la liste **complète** des players/senders (incluant inactifs), mais le serveur ne renvoie que `*_visible` (actifs) aux clients.

---

## 1) Meta

### Key
- `room:{code}:meta` — `STRING(JSON)`

### JSON
```json
{
  "code": "ABCD1234",
  "created_at": 1730000000000,
  "expires_at": 1730043200000,
  "phase": "lobby",
  "version": 1,
  "master_key": "MASTER_SECRET"
}
```

### Notes

* `master_key` peut être stocké en clair (MVP) ou hashé (recommandé en prod).
* `version` s’incrémente à chaque mutation importante (utile pour debug/resync).

---

## 2) Senders

### Key

* `room:{code}:senders` — `STRING(JSON)`

### JSON

Liste complète (actifs + inactifs) :

```json
[
  { "sender_id": "s12", "name": "Camille", "active": true,  "reels_count": 37 },
  { "sender_id": "s44", "name": "Nico",    "active": false, "reels_count": 0 }
]
```

---

## 3) Players

### Key

* `room:{code}:players` — `STRING(JSON)`

### JSON

Liste complète :

```json
[
  {
    "player_id": "p12",
    "sender_id": "s12",
    "is_sender_bound": true,
    "active": true,
    "name": "Camille",
    "avatar_url": null
  },
  {
    "player_id": "p44",
    "sender_id": "s44",
    "is_sender_bound": true,
    "active": false,
    "name": "Nico",
    "avatar_url": null
  }
]
```

### Notes

* Pas de champ `status` stocké ici : `free/taken` est dérivé des claims.
* Les clients ne reçoivent que les `active=true`.

---

## 4) Claims (prise de player)

### Key

* `room:{code}:claims` — `HASH`

### Contenu

* field : `player_id`
* value : `device_id`

Exemple :

* `HSET room:ABCD1234:claims p12 9f3e...`

### Invariant

* Un `device_id` ne doit apparaître qu’une seule fois comme value dans ce hash.

  * L’atomicité doit être assurée par Lua (voir section opérations).

---

## 5) Scores (cumul global)

### Key

* `room:{code}:scores` — `HASH`

### Contenu

* field : `player_id`
* value : int (score total)

Exemple :

* `HSET room:ABCD1234:scores p12 3 p99 1`

---

## 6) Round delta (points gagnés dans le round)

### Key

* `room:{code}:round_delta:{round_id}` — `HASH`

### Contenu

* field : `player_id`
* value : int (points gagnés durant ce round)

Exemple :

* `HSET room:ABCD1234:round_delta:r1 p12 2 p99 0`

### Cycle de vie

* Créé/initialisé au démarrage du round (à `START_GAME` pour r1, et à `START_NEXT_ROUND` pour suivants).
* Mis à jour à chaque calcul de vote (HINCRBY).
* Lu pour `ROUND_RECAP`.

---

## 7) Game state (progression)

### Key

* `room:{code}:game` — `STRING(JSON)`

### JSON

```json
{
  "phase": "lobby",
  "round_order": ["r1", "r2", "r3"],
  "current_round_id": null,
  "current_item_index": null,
  "status": "idle",

  "vote": null,

  "version": 1
}
```

Quand `phase=game` et un vote est ouvert :

```json
{
  "phase": "game",
  "round_order": ["r1", "r2"],
  "current_round_id": "r1",
  "current_item_index": 0,
  "status": "vote",
  "vote": {
    "round_id": "r1",
    "item_id": "i1",
    "expected_player_ids": ["p12", "p99"]
  },
  "version": 12
}
```

Quand round terminé :

```json
{
  "phase": "game",
  "round_order": ["r1", "r2"],
  "current_round_id": "r1",
  "current_item_index": 5,
  "status": "round_recap",
  "vote": null,
  "version": 21
}
```

---

## 8) Round data (immuable)

### Key

* `room:{code}:round:{round_id}` — `STRING(JSON)`

### JSON

```json
{
  "round_id": "r1",
  "created_at": 1730000000000,
  "items": [
    {
      "item_id": "i1",
      "reel": { "reel_id": "reel_abc", "url": "https://www.instagram.com/reel/XYZ/" },
      "true_sender_ids": ["s12", "s44"],
      "k": 2
    }
  ]
}
```

### Notes

* `true_sender_ids` est stocké en Redis (serveur-only).
* Jamais envoyé aux Plays avant la fin du vote.

---

## 9) Votes (par item)

### Key

* `room:{code}:votes:{round_id}:{item_id}` — `HASH`

### Contenu

* field : `player_id`
* value : JSON string `{"selections":["s12"],"ts":1730000000000}`

Ex :

* `HSET room:ABCD1234:votes:r1:i1 p12 '{"selections":["s12","s44"],"ts":...}'`

### Cycle

* `DEL` au `REEL_OPENED` (reset)
* `DEL` au `END_ITEM` (cleanup)

---

## 10) Ranking (non stocké)

* Le classement est calculé à la demande au `GAME_OVER` à partir de `scores`.
* Pas de clé dédiée.

---

# 11) Opérations Redis par message (résumé)

## CREATE_ROOM

Écrit :

* `SET room:{code}:meta`
* `SET room:{code}:senders`
* `SET room:{code}:players`
* `HSET room:{code}:scores` (init 0)
* `SET room:{code}:game` (phase=lobby)
* `SET room:{code}:round:{rid}` pour chaque round
* `DEL room:{code}:claims` (ou `HDEL`/init vide)

Puis `EXPIRE 43200` sur toutes les clés.

## JOIN_ROOM / STATE_SYNC

Lit :

* `GET meta`, `GET players`, `GET senders`, `HGETALL claims`, `HGETALL scores`, `GET game`
* si phase=game : lit `GET round:{current_round_id}` pour construire l’item courant

## TAKE_PLAYER (atomique)

Lire/écrire :

* `HGET claims player_id`
* vérifier “device n’a pas déjà un claim” (scan values)
* `HSET claims player_id device_id`

⚠️ doit être atomique via Lua (voir section 12).

## RENAME_PLAYER

* `GET players`, `GET senders`
* modifier JSON
* `SET players`, `SET senders`

## UPDATE_AVATAR

* `GET players` → update `avatar_url` → `SET players`

## TOGGLE_PLAYER (lobby only)

* `GET players` → update `active` → `SET players`
* si active=false : `HDEL claims player_id`

## START_GAME

* `GET players`, `HGETALL claims` pour vérifier conditions
* `GET game` → set phase/game pointers → `SET game`
* init `room_delta:r1` à 0 pour players actifs (HSET)
* `SET meta.phase=game` (ou update meta JSON)

## REEL_OPENED

* `DEL votes:{rid}:{item}`
* snapshot expected voters :

  * `GET players` + `HGETALL claims`
  * set `game.vote.expected_player_ids` → `SET game`
* set `game.status=vote`

## SUBMIT_VOTE

* `HSET votes:{rid}:{item} player_id ...`
* si tous voté :

  * `HGETALL votes...`
  * `GET round:{rid}` pour true_sender_ids
  * `HINCRBY scores[player_id] +n`
  * `HINCRBY round_delta:{rid}[player_id] +n`
  * set `game.status=reveal_wait`, clear vote if desired

## END_ITEM

* `DEL votes:{rid}:{item}`
* incr `game.current_item_index`
* si fin round : set `game.status=round_recap`, clear `game.vote`
* sinon : set `game.status=idle`
* `SET game`

## START_NEXT_ROUND

* si prochain round : set pointers (`current_round_id`, `current_item_index=0`, `status=idle`)
* init `round_delta:{newRid}` à 0
* `SET game`
* sinon : `SET meta.phase=over`

## ROOM_CLOSED

* `DEL room:{code}:*` (pattern delete via scan)

---

# 12) Scripts Lua (nécessaires)

## 12.1 TAKE_PLAYER atomique (recommandé)

But : empêcher 2 devices de prendre le même player et empêcher 1 device de prendre 2 players.

Entrées :

* key claims: `room:{code}:claims`
* args : `player_id`, `device_id`

Règles :

* si `claims[player_id]` existe et != device_id → FAIL taken_now
* si une valeur du hash == device_id sur un autre player_id → FAIL device_already_has_player
* sinon `HSET claims[player_id]=device_id` → OK

Note : la vérification “device déjà owner” nécessite de parcourir les champs du hash dans Lua.



