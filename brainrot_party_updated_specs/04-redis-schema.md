
# 04 — Redis Schema (Clés + JSON + TTL) — v3

Décisions intégrées :
- `STATE_SYNC_RESPONSE` :
  - contient toujours `players_visible`, `senders_visible`
  - contient aussi `players_all` (et `senders_all`) si `master_key` valide
  - contient aussi, si `phase=game` :
    - `votes_received_player_ids` si `status=vote` (master only)
    - `current_vote_results` si `status=reveal_wait` (master only)
- Stockage des résultats : **dans `room:{code}:game`** (champ `current_vote_results`) (option A)
- `master_key` stocké **hashé** (`master_key_hash`)
- `ROOM_CLOSED` via `SCAN` + `DEL` batch
- TTL 12h fixé à la création, pas de refresh

Préfixe : `room:{code}:...`

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

---

## 2) Senders (complet)

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

## 3) Players (complet)

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

---

## 4) Claims

### Key

* `room:{code}:claims` — `HASH`
* field: `player_id`
* value: `device_id`

Invariant : un `device_id` ne peut apparaître qu’une seule fois (Lua).

---

## 5) Scores (cumul)

### Key

* `room:{code}:scores` — `HASH`
* field: `player_id`
* value: int

---

## 6) Round delta (delta par round)

### Key

* `room:{code}:round_delta:{round_id}` — `HASH`
* field: `player_id`
* value: int

---

## 7) Game state (progression + vote + results)

### Key

* `room:{code}:game` — `STRING(JSON)`

### JSON (lobby)

```json
{
  "phase": "lobby",
  "round_order": ["r1", "r2"],
  "current_round_id": null,
  "current_item_index": null,
  "status": "idle",
  "current_vote": null,
  "votes_received_player_ids": null,
  "current_vote_results": null,
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
  "current_vote": {
    "round_id": "r1",
    "item_id": "i1",
    "expected_player_ids": ["p12", "p99"]
  },
  "votes_received_player_ids": ["p12"],
  "current_vote_results": null,
  "version": 12
}
```

### JSON (reveal_wait : results stockés)

```json
{
  "phase": "game",
  "round_order": ["r1", "r2"],
  "current_round_id": "r1",
  "current_item_index": 0,
  "status": "reveal_wait",
  "current_vote": {
    "round_id": "r1",
    "item_id": "i1",
    "expected_player_ids": ["p12", "p99"]
  },
  "votes_received_player_ids": null,
  "current_vote_results": {
    "round_id": "r1",
    "item_id": "i1",
    "true_senders": ["s12", "s44"],
    "players": [
      {
        "player_id": "p12",
        "selections": ["s12","s44"],
        "correct": ["s12","s44"],
        "incorrect": [],
        "points_gained": 2,
        "score_total": 5
      }
    ]
  },
  "version": 18
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
  "current_vote": null,
  "votes_received_player_ids": null,
  "current_vote_results": null,
  "version": 25
}
```

Notes :

* `votes_received_player_ids` n’est utile que pendant `status=vote` (reconstruction des cochettes Master).
* `current_vote_results` n’est utile que pendant `status=reveal_wait` (reprise Master après refresh).
* Nettoyage :

  * au `END_ITEM` : `current_vote=null`, `votes_received_player_ids=null`, `current_vote_results=null`.

---

## 8) Round data (immuable)

### Key

* `room:{code}:round:{round_id}` — `STRING(JSON)`

Inclut `true_sender_ids` + `k`.

---

## 9) Votes (par item)

### Key

* `room:{code}:votes:{round_id}:{item_id}` — `HASH`
* field: `player_id`
* value: `{"selections":[...],"ts":...}`

---

## 10) Opérations (diffs principaux)

### SUBMIT_VOTE (accepted)

* `HSET votes:{rid}:{item}[player_id]=...`
* `GET game.current_vote.expected_player_ids`
* update `game.votes_received_player_ids` (append si pas déjà présent)
* si complet :

  * compute results
  * `HINCRBY scores`, `HINCRBY round_delta`
  * `SET game.status=reveal_wait`
  * `SET game.current_vote_results = computed`
  * `SET game.votes_received_player_ids = null` (optionnel, car vote fini)

### STATE_SYNC (master_key valid)

* renvoie `players_visible` + `players_all`
* renvoie `votes_received_player_ids` si `status=vote`
* renvoie `current_vote_results` si `status=reveal_wait`

---

## 11) ROOM_CLOSED

* `SCAN MATCH room:{code}:* COUNT 200` + `DEL` batch jusqu’à cursor=0

````

```md
# 06 — Frontend Master (Pages + Stores + Events) — v2

Mises à jour :
- Resync Master reconstruit :
  - cochettes vote via `votes_received_player_ids` (status=vote)
  - reveal via `current_vote_results` (status=reveal_wait)
- `STATE_SYNC_RESPONSE` fournit `players_all` si master_key valid

---

## 2) Master WS lifecycle (global)

À l’entrée lobby/game :
1) open WS
2) `STATE_SYNC {code, device_id: master_device_id, master_key}`
3) router selon `STATE_SYNC_RESPONSE.phase` et `game.status`

---

## 4) Page Master Game (diff)

### 4.1 Entrée page + resync
Sur `STATE_SYNC_RESPONSE` :

- si `phase=game`:
  - si `status=idle` → UI item standard
  - si `status=vote` :
    - `voted_by_player` = map depuis `votes_received_player_ids`
    - afficher “vote en cours”
  - si `status=reveal_wait` :
    - `last_vote_results = current_vote_results`
    - proposer 2 UX possibles (choisir une) :
      1) relancer reveal automatiquement
      2) bouton “Relancer la révélation”
  - si `status=round_recap` :
    - ouvrir modal recap (si recap est disponible via un autre payload; sinon simple écran “round terminé”)

### 4.2 Gestion vote indicators
- À la réception `PLAYER_VOTED` : set local boolean
- Après refresh :
  - rebuild via `votes_received_player_ids` (serveur)

### 4.3 Reveal recovery (bloquant résolu)
- Quand `VOTE_RESULTS` reçu : lancer reveal
- Quand `STATE_SYNC_RESPONSE` avec `status=reveal_wait` + `current_vote_results` :
  - Master peut relancer reveal et terminer avec `END_ITEM`

---

## 6) Décisions bloquantes — résolues
1) reveal_wait resync : OUI → `current_vote_results` inclus (Master only)
2) vote resync : OUI → `votes_received_player_ids` inclus (Master only)
3) players_all : OUI si master_key valid
4) stockage results : dans `room:{code}:game`
````

