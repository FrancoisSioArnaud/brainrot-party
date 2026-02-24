
# 09 — Backend Implementation Plan (Handlers + Signatures + Redis ops)

Objectif : pouvoir coder “sans réfléchir” handler par handler.
Aligné avec :
- ws/messages.ts v3
- Redis keys & JSON types (08)
- State machine (02 v3)
- Protocol (03 v3)

Conventions :
- `repo.*` = `redis/roomRepo.ts`
- `bc.*` = `ws/broadcast.ts`
- `err.*` = `ws/errors.ts`
- `auth.*` = `ws/auth.ts`
- `now()` = ms epoch

---

## 0) Signatures standard

Chaque handler prend :
```ts
type Ctx = {
  ws: WebSocket;
  registry: Registry;   // room->sockets + socket meta
  repo: RoomRepo;
};

type Handler<T> = (ctx: Ctx, payload: T) => Promise<void>;
````

Helper send :

* `send(ws, msg)`
* `broadcastRoom(code, msg)`
* `broadcastRoomPlaysOnly(code, msg)` (si tu veux filtrer; sinon broadcast et Play ignore)

---

## 1) CREATE_ROOM

### Handler

`createRoom(ctx, payload: CreateRoomReq)`

### Steps

1. Validate payload (senders, rounds non vides, ids uniques)
2. Generate:

   * `code = genRoomCode()`
   * `master_key = genMasterKey()`
   * `master_key_hash = sha256(master_key)` → store `"sha256:<hex>"`
3. Compute:

   * `created_at = now()`
   * `expires_at = created_at + 12h`
   * `round_order = payload.round_order ?? payload.rounds.map(r=>r.round_id)`
4. Build `playersAll` from senders:

   * one player per sender
   * `player_id = "p_" + sender_id` (stable) ou `uuid` (choisir, mais être déterministe est pratique)
   * `name = sender.name`
   * `active = sender.active`
   * `avatar_url = null`
5. Redis writes:

   * `SET meta`
   * `SET senders`
   * `SET players`
   * `HSET scores` init 0 for each player_id
   * `DEL claims`
   * `SET game` (phase=lobby,status=idle,current_vote=null,...)
   * `SET round:{rid}` for each round
6. Apply TTL 43200 on every key created
7. Registry:

   * join socket into room (so broadcast works)
   * mark socket meta `is_master=true` (because it holds master_key now)
8. Reply:

   * `ROOM_CREATED {code, master_key, phase:lobby, players_visible, senders_visible}`

### Redis ops checklist

* `SET room:{code}:meta`
* `SET room:{code}:senders`
* `SET room:{code}:players`
* `DEL room:{code}:claims`
* `HSET room:{code}:scores ...`
* `SET room:{code}:game`
* `SET room:{code}:round:{rid}` xN
* `EXPIRE` on all above

---

## 2) JOIN_ROOM

### Handler

`joinRoom(ctx, payload: JoinRoomReq)`

### Steps

1. `meta = repo.getMeta(code)` else `ERROR room_not_found|room_expired`
2. Registry:

   * attach `ws` to room `code`
   * store socket meta `code`, `device_id`
3. Read:

   * `playersAll`
   * `claims`
4. Build:

   * `players_visible = buildPlayersVisible(playersAll, claims)`
5. Reply:

   * `JOIN_OK {code, phase: meta.phase, players_visible}`

---

## 3) STATE_SYNC

### Handler

`stateSync(ctx, payload: StateSyncReq)`

### Steps

1. Read `meta` else error
2. Registry: ensure socket is joined to `code`, store `device_id`
3. Read:

   * `playersAll`, `sendersAll`, `claims`, `scores`, `game`
4. Compute always:

   * `players_visible`, `senders_visible`
   * `my_player_id` by searching `claims` for value==device_id (O(n)) (ok small) or keep reverse map (not needed)
   * If `meta.phase=="game"` and `game.current_round_id != null`:

     * load `round = repo.getRound(code, game.current_round_id)`
     * item = round.items[game.current_item_index]
     * build `game.item` payload (round_id,item_id,reel,k,senders_selectable)
5. Master-only branch:

   * if payload.master_key provided:

     * `isMaster = auth.verifyMasterKey(meta.master_key_hash, payload.master_key)`
     * if true:

       * include `players_all`, `senders_all`
       * if `game.status=="vote"` include `votes_received_player_ids` from game
       * if `game.status=="reveal_wait"` include `current_vote_results` from game
       * mark socket meta `is_master=true`
6. Reply `STATE_SYNC_RESPONSE`

### Redis ops checklist

* `GET meta, players, senders, game`
* `HGETALL claims, scores`
* optional `GET round:{rid}`

---

## 4) TAKE_PLAYER (Lua)

### Handler

`takePlayer(ctx, payload: TakePlayerReq)`

### Steps

1. Read `meta` must be lobby else `ERROR not_in_phase`
2. Read playersAll:

   * ensure player exists and `active==true`
3. Lua `takePlayerAtomic(code, player_id, device_id)`
4. If fail → `TAKE_PLAYER_FAIL {reason}`
5. If ok:

   * reply `TAKE_PLAYER_OK`
   * compute updated `players_visible` or derive single player visible update:

     * easiest: read `claims` and recompute status for that player only
   * broadcast `PLAYER_UPDATE` (to all in room)

### Redis ops checklist

* `GET meta`
* `GET players`
* `EVALSHA takePlayer.lua` (HSET claims)
* broadcast (no extra Redis if you can derive)

  * else `HGETALL claims` to rebuild status

---

## 5) RENAME_PLAYER

### Handler

`renamePlayer(ctx, payload: RenamePlayerReq)`

### Steps

1. meta must be lobby
2. verify claim: `HGET claims[player_id] == device_id` else `ERROR not_claimed`
3. Read `playersAll`, `sendersAll`
4. Update player.name = new_name
5. If `is_sender_bound`:

   * find sender by sender_id and set sender.name = new_name
6. Write:

   * `SET players`
   * `SET senders`
7. Build `player_visible` for broadcast:

   * need `claims` to derive status; you already have claim for this player = device
   * status = taken, active=true guaranteed (or still active)
8. Broadcast `PLAYER_UPDATE {player, sender_updated?}`

---

## 6) UPDATE_AVATAR (dataURL 300x300)

### Handler

`updateAvatar(ctx, payload: UpdateAvatarReq)`

### Steps

1. meta must be lobby
2. verify claim
3. validate image string:

   * startsWith `data:image/`
   * length < MAX (ex 200k chars)
4. Read `playersAll`
5. Update player.avatar_url = image (dataURL JPEG 300x300)
6. `SET players`
7. Broadcast `PLAYER_UPDATE`

---

## 7) TOGGLE_PLAYER (Master)

### Handler

`togglePlayer(ctx, payload: TogglePlayerReq)`

### Steps

1. meta must be lobby
2. verify master
3. Read `playersAll`
4. Update player.active = payload.active
5. `SET players`
6. If active=false:

   * `HGET claims[player_id]` (if any)
   * `HDEL claims[player_id]`
   * Send `SLOT_INVALIDATED {player_id}` to that specific device if you can map device->ws

     * else broadcast to room; Play will handle if it matches its claimed player
7. Broadcast `PLAYER_UPDATE` with player_visible if still active, else you can omit or send active=false via a separate master-only update.

   * Simpler: broadcast `PLAYER_UPDATE` built as visible only when active=true.
   * If active=false, Plays shouldn’t see it anyway; Master sees via `players_all` (STATE_SYNC).
   * Donc :

     * broadcast `PLAYER_UPDATE` only if active=true
     * and broadcast `STATE_CHANGED`? (not in protocol) → so rely on clients resync or on the fact Plays list is from visible only.
     * For MVP: after toggle, also broadcast a `STATE_SYNC`-like update is too heavy.
     * Better: define `PLAYER_UPDATE` to be sent only for active=true (OK), and Plays remove on resync.
8. Reco MVP pragmatique :

   * après toggle, broadcast `PLAYER_UPDATE` si active=true
   * broadcast `SLOT_INVALIDATED` si claim removed
   * Master UI uses local state + can resync if needed

---

## 8) START_GAME (Master)

### Handler

`startGame(ctx, payload: StartGameReq)`

### Steps

1. meta must be lobby
2. verify master
3. Read:

   * playersAll
   * claims
   * game (contains round_order)
4. Condition:

   * activePlayers = playersAll.filter(p=>p.active)
   * activePlayers.length >= 2
   * all activePlayers are claimed (claims has field for each)
5. Write:

   * meta.phase=game
   * game.phase=game
   * game.current_round_id = round_order[0]
   * game.current_item_index = 0
   * game.status=idle
   * clear current_vote/results
   * init round_delta for round 1 with 0 for active players
6. Broadcast:

   * `GAME_START`
   * `NEW_ITEM` (build from round data)

---

## 9) REEL_OPENED (Master)

### Handler

`reelOpened(ctx, payload: ReelOpenedReq)`

### Steps

1. meta must be game
2. verify master
3. Read:

   * game must be status idle
   * playersAll + claims
   * round current, item current
4. Validate round_id/item_id match current pointers
5. Reset:

   * `DEL votes:{rid}:{item}`
6. Snapshot expected:

   * expected = active & claimed player_ids at this time
7. Update game:

   * status=vote
   * current_vote={round_id,item_id,expected_player_ids}
   * votes_received_player_ids=[]
   * current_vote_results=null
8. Write game
9. Broadcast to Plays:

   * `START_VOTE {round_id,item_id,k,senders_selectable}`

---

## 10) SUBMIT_VOTE (Play)

### Handler

`submitVote(ctx, payload: SubmitVoteReq)`

### Steps

1. meta must be game
2. Read game:

   * status must be vote
   * check payload round_id/item_id == game.current_vote
3. Verify claim:

   * `HGET claims[player_id] == device_id`
4. Verify expected:

   * `player_id in current_vote.expected_player_ids`
5. Validate selections:

   * length == k (from round item)
   * all senders exist and are active (senders_visible)
   * no duplicates
6. Persist vote:

   * `HSET votes:{rid}:{item}[player_id] = JSON.stringify({selections, ts: now()})`
7. Update tracking:

   * game.votes_received_player_ids append player_id if not present
   * `SET game`
8. Respond to Play:

   * `VOTE_ACK {accepted:true}`
9. Notify Master:

   * `PLAYER_VOTED {player_id}`
10. Completion check:

* if `votes_received_player_ids.length == expected_player_ids.length` :

  * load votes hash (HGETALL)
  * compute:

    * correct/incorrect per player
    * points_gained = correct.length
  * update:

    * `HINCRBY scores`
    * `HINCRBY round_delta:{rid}`
  * update game:

    * status=reveal_wait
    * current_vote_results = computed (include score_total after incr)
    * votes_received_player_ids=null
  * `SET game`
  * send to Master:

    * `VOTE_RESULTS`

---

## 11) END_ITEM (Master)

### Handler

`endItem(ctx, payload: EndItemReq)`

### Steps

1. meta must be game
2. verify master
3. read game:

   * status must be reveal_wait
   * validate payload round_id/item_id == game.current_vote
4. cleanup votes:

   * `DEL votes:{rid}:{item}`
5. advance pointer:

   * `current_item_index += 1`
6. clear:

   * `current_vote=null`
   * `current_vote_results=null`
7. if next item exists:

   * status=idle
   * write game
   * broadcast `NEW_ITEM` to all
8. else (round finished):

   * status=round_recap
   * write game
   * build recap:

     * round_delta = HGETALL
     * scores = HGETALL
   * send:

     * `ROUND_RECAP` to Master
     * `ROUND_FINISHED` to Plays

---

## 12) START_NEXT_ROUND (Master)

### Handler

`startNextRound(ctx, payload: StartNextRoundReq)`

### Steps

1. meta must be game
2. verify master
3. game.status must be round_recap
4. determine next round index in round_order
5. if none:

   * meta.phase=over
   * compute ranking from scores
   * broadcast `GAME_OVER`
6. else:

   * set:

     * current_round_id=next
     * current_item_index=0
     * status=idle
   * init round_delta for next round (0 for active players)
   * broadcast `NEW_ITEM`

---

## 13) ROOM_CLOSED (Master)

### Handler

`roomClosed(ctx, payload: RoomClosedReq)`

### Steps

1. verify master
2. repo.deleteRoomByScan(code)
3. broadcast `ROOM_CLOSED_BROADCAST`

---

## 14) Compute helpers (pure functions)

### 14.1 `computeVoteResults(trueSenderIds, votesByPlayer)`

Returns `CurrentVoteResults`:

* correct = selections ∩ trueSenderIds
* incorrect = selections \ trueSenderIds
* points_gained = correct.length

### 14.2 `buildNewItem(code, round, itemIndex, sendersVisible)`

Returns `NEW_ITEM` payload with:

* reel, k
* senders_selectable = sendersVisible mapped
* slots_total = k

---

## 15) Required repo methods (minimal set)

* Meta: `getMeta`, `setMeta`
* Senders/Players: `getSendersAll`, `setSendersAll`, `getPlayersAll`, `setPlayersAll`
* Claims: `getClaims`, `getClaim(player_id)`, `takePlayerAtomic`, `releaseClaim`
* Scores: `getScores`, `incrScore`
* Round delta: `getRoundDelta`, `incrRoundDelta`, `initRoundDelta`
* Game: `getGame`, `setGame`
* Round: `getRound`, `setRound`
* Votes: `resetVotes`, `setVote`, `getVotesAll`
* Close: `deleteRoomByScan`


