
# 04 — Redis Schema (Clés + JSON + TTL) — v2

Décisions intégrées :
- Redis only, TTL fixé à la création : **12 heures** (43200s), pas de refresh
- `master_key` en **prod** : stocké **hashé** (`master_key_hash`)
- Fix minimal pour Master :
  - `STATE_SYNC` accepte `master_key` (optionnel)
  - si `master_key` valide → serveur renvoie `players_all` (actifs + inactifs)
  - sinon → serveur renvoie `players_visible` (actifs uniquement)
- `ROOM_CLOSED` : suppression via `SCAN MATCH room:{code}:*` + `DEL` par batch (pas de wildcard DEL)

Préfixe standard :
- `room:{code}:...`

---

## 0) Conventions

### TTL
- Chaque clé de la room reçoit `EXPIRE 43200` au moment de la création.
- Pas de refresh TTL.
- `ROOM_CLOSED` supprime toutes les clés `room:{code}:*` via SCAN.

### Types Redis
- `STRING(JSON)` : string contenant un JSON sérialisé
- `HASH` : hash Redis (fields → values)

### Visibilité
- Stockage : listes complètes (actifs + inactifs) pour `players` et `senders`.
- Sortie serveur :
  - Play : `*_visible` (actifs)
  - Master via `STATE_SYNC` + `master_key` : `players_all` (+ éventuellement `senders_all` si utile)

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

  "master_key_hash": "sha256:...."
}
````

### Notes

* `master_key_hash` = hash du secret renvoyé au Master au `CREATE_ROOM`.
* Algorithme recommandé : SHA-256 (ou argon2/bcrypt si tu veux, mais SHA-256 suffit ici).

---

## 2) Senders (liste complète)

### Key

* `room:{code}:senders` — `STRING(JSON)`

### JSON

```json
[
  { "sender_id": "s12", "name": "Camille", "active": true,  "reels_count": 37 },
  { "sender_id": "s44", "name": "Nico",    "active": false, "reels_count": 0 }
]
```

---

## 3) Players (liste complète)

### Key

* `room:{code}:players` — `STRING(JSON)`

### JSON

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

* Pas de champ `status` stocké : `free/taken` dérivé de `claims`.
* Les clients Play reçoivent uniquement `active=true`.
* Le Master peut obtenir `players_all` via `STATE_SYNC` avec `master_key`.

---

## 4) Claims (prise de player)

### Key

* `room:{code}:claims` — `HASH`

### Contenu

* field : `player_id`
* value : `device_id`

Ex :

* `HSET room:ABCD1234:claims p12 9f3e...`

### Invariant

* Un `device_id` ne doit apparaître qu’une seule fois comme value dans ce hash (un device = un player).
* Opération atomique via Lua.

---

## 5) Scores (cumul global)

### Key

* `room:{code}:scores` — `HASH`

### Contenu

* field : `player_id`
* value : int (score total)

Ex :

* `HSET room:ABCD1234:scores p12 3 p99 1`

---

## 6) Round delta (points gagnés dans le round)

### Key

* `room:{code}:round_delta:{round_id}` — `HASH`

### Contenu

* field : `player_id`
* value : int (delta de points sur le round)

Ex :

* `HSET room:ABCD1234:round_delta:r1 p12 2 p99 0`

### Cycle

* Initialisé à 0 au début du round :

  * au `START_GAME` pour `r1`
  * au `START_NEXT_ROUND` pour les rounds suivants
* Mis à jour à chaque calcul complet de vote (`HINCRBY`)
* Lu pour `ROUND_RECAP`

---

## 7) Game state (progression)

### Key

* `room:{code}:game` — `STRING(JSON)`

### JSON (lobby)

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

### JSON (vote ouvert)

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

### JSON (round recap)

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

# 10) Opérations Redis par message (résumé)

## CREATE_ROOM

Écrit :

* `SET room:{code}:meta` (avec `master_key_hash`)
* `SET room:{code}:senders`
* `SET room:{code}:players`
* `HSET room:{code}:scores` (init 0 pour tous players)
* `SET room:{code}:game` (phase=lobby)
* `SET room:{code}:round:{rid}` pour chaque round
* `DEL room:{code}:claims` (init vide)
  Puis `EXPIRE 43200` sur toutes les clés.

## JOIN_ROOM

Lit :

* `GET meta`, `GET players`, `HGETALL claims`
  Répond :
* `players_visible` = filtre `players.active=true` + status dérivé claims

## STATE_SYNC (fix minimal Master)

Lit :

* `GET meta`, `GET players`, `GET senders`, `HGETALL claims`, `HGETALL scores`, `GET game`
* Si `master_key` fourni :

  * hash et compare à `meta.master_key_hash`
  * si ok : renvoie `players_all` (actifs + inactifs) et `senders_all` si utile
  * sinon : comportement Play (visible only)

## TAKE_PLAYER (atomique)

* Lua : empêche double prise du même player + empêche un device d’avoir 2 players
* `HSET claims[player_id]=device_id`

## RENAME_PLAYER

* `GET players`, `GET senders` → modifier JSON → `SET players`, `SET senders`

## UPDATE_AVATAR

* `GET players` → update `avatar_url` → `SET players`

## TOGGLE_PLAYER (lobby only)

* `GET players` → update `active` → `SET players`
* si `active=false` : `HDEL claims[player_id]`

## START_GAME

* vérifs via `GET players` + `HGETALL claims`
* update `meta.phase=game`
* update `game.phase=game`, pointers, `status=idle`
* init `round_delta:{r1}` à 0

## REEL_OPENED

* `DEL votes:{rid}:{item}`
* snapshot expected voters (actifs + claimés) → `SET game.vote.expected_player_ids`
* set `game.status=vote`

## SUBMIT_VOTE

* `HSET votes:{rid}:{item} player_id ...`
* quand complet (tous expected) :

  * `HGETALL votes...` + `GET round:{rid}`
  * `HINCRBY scores` + `HINCRBY round_delta:{rid}`
  * `SET game.status=reveal_wait`

## END_ITEM

* `DEL votes:{rid}:{item}`
* incr `game.current_item_index`
* clear `game.vote`
* si fin round : `SET game.status=round_recap`
* sinon : `SET game.status=idle`

## START_NEXT_ROUND

* si next round :

  * `game.current_round_id = next`
  * `game.current_item_index = 0`
  * `game.status = idle`
  * init `round_delta:{next}` à 0
* sinon :

  * `meta.phase = over`

---

# 11) Scripts Lua (nécessaires)

## 11.1 TAKE_PLAYER atomique

Keys :

* `room:{code}:claims`

Args :

* `player_id`, `device_id`

Règles :

* si `claims[player_id]` existe et != device_id → FAIL `taken_now`
* si un autre field du hash a value == device_id → FAIL `device_already_has_player`
* sinon `HSET claims[player_id]=device_id` → OK

---

# 12) ROOM_CLOSED (suppression correcte)

Redis ne supporte pas `DEL room:{code}:*`.

Procédure :

1. `SCAN cursor MATCH room:{code}:* COUNT 200`
2. `DEL` sur le batch de clés retournées
3. répéter jusqu’à cursor=0

Puis broadcast `ROOM_CLOSED_BROADCAST`.

```
```
