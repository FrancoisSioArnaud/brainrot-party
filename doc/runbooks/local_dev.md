# Local Development Runbook

Goal: start Redis + backend + frontend with one workflow and predictable ports.

---

## Requirements
- Node.js (LTS)
- npm
- Redis (local install OR Docker)

---

## Environment variables

Create `.env` files (do not commit secrets).

### backend/.env
```env
NODE_ENV=development
PORT=3010
REDIS_URL=redis://127.0.0.1:6379
CORS_ORIGIN=http://localhost:5173
ROOM_TTL_SECONDS=86400
````

### frontend/.env (optional)

```env
VITE_BACKEND_HTTP=http://localhost:3010
VITE_BACKEND_WS=ws://localhost:3010
```

---

## Start Redis

### Option A — Docker (recommended)

From repo root:

```bash
docker run --name brp-redis -p 6379:6379 -d redis:7
```

Stop:

```bash
docker stop brp-redis
```

Remove:

```bash
docker rm brp-redis
```

### Option B — Local Redis

Install and run Redis normally for your OS.
Ensure `redis-cli ping` returns `PONG`.

---

## Start backend

From repo root:

```bash
cd backend
npm install
npm run dev
```

Expected:

* HTTP on `http://localhost:3010`
* WS on `ws://localhost:3010`

Healthcheck (if implemented):

```bash
curl http://localhost:3010/health
```

---

## Start frontend

From repo root (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

Expected:

* Vite on `http://localhost:5173`

---

## Common issues

### WS connects but no updates

* Check backend logs for `JOIN_ROOM`
* Ensure frontend uses correct WS URL
* Ensure `CORS_ORIGIN` matches Vite origin

### Room not found immediately

* Check Redis is running
* Check `REDIS_URL`
* Check backend logs around room creation and meta/state writes

### Protocol mismatch

* Client `JOIN_ROOM.protocol_version` must match server `PROTOCOL_VERSION`
* Update `contracts/` and rebuild if needed

---

## Suggested dev workflow

1. Start Redis
2. Start backend (`npm run dev`)
3. Start frontend (`npm run dev`)
4. Create a room (Master)
5. Join as Play (Enter code)
6. Validate `STATE_SYNC_RESPONSE` updates on each action

```

---
```
