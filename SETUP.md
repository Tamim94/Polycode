# Setup & Usage

Everything runs locally via Docker Compose. No accounts, no cloud credentials, no external services required.

---

## Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| Docker Desktop (or Docker Engine) | 24.x | `docker --version` |
| Docker Compose plugin | 2.x | `docker compose version` |
| ffmpeg | any | Only needed to **regenerate** the encrypted video assets manually. Not required for `docker-compose up`. |

> **Note:** The encrypted HLS video is generated automatically inside the `video-server` Docker image at build time. You do not need ffmpeg installed on your machine to run the stack.

---

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url>
cd polycode

# 2. Build all images and start all services
docker compose up --build

# 3. Open the app
# http://localhost:3000
```

First build takes 3–5 minutes (npm install + ffmpeg video encoding inside containers). Subsequent starts without `--build` are near-instant.

To stop:
```bash
docker compose down
```

---

## Port Map

| Service | URL | What's there |
|---------|-----|--------------|
| Frontend | http://localhost:3000 | React app (both modules) |
| Realtime server | ws://localhost:8080 | WebSocket endpoint (Module 1A) |
| Key server | http://localhost:8000 | Token issuance + AES key gate (Module 2A) |
| Video server | http://localhost:8082 | Encrypted HLS playlist and segments (Module 2A) |
| Key server docs | http://localhost:8000/docs | FastAPI auto-generated OpenAPI UI |

---

## Module 1A — Testing Multi-User Real-Time Sync

1. Open **two browser tabs**, both pointing to `http://localhost:3000`.
2. In Tab 1, note the **Session ID** shown in the toolbar (e.g., `a3f7b2c1`).
3. In Tab 2, paste that same session ID into the session input and click **Join**.
4. Tab 2 will receive a `sync` message with Tab 1's current state (if any).
5. Toggle **Drawing ON** in either tab and draw on the canvas.
6. The annotation appears in the other tab within milliseconds.
7. Post a comment — it appears in both tabs with its timestamp. Click it to seek the video.

**Testing reconnect resync:**
1. Draw some strokes in Tab 1.
2. In Tab 2, open DevTools → Network → disable the WebSocket connection (or use DevTools to throttle offline briefly).
3. Re-enable. Tab 2 auto-reconnects and re-receives the full session state.

**Export:**
Click **Export JSON** in either tab. You receive a file like `session-a3f7b2c1.json` containing all strokes (with tool, color, coordinates) and comments (with text and video timestamp).

---

## Module 2A — Security Proof

The following `curl` commands demonstrate that the key gate is real, not cosmetic.

### Attempt to fetch the AES key without a token (should fail)

```bash
curl -i http://localhost:8000/key
```

Expected response:
```
HTTP/1.1 403 Forbidden
{"detail":"Missing or malformed Authorization header"}
```

### Attempt with an invalid/expired token (should fail)

```bash
curl -i http://localhost:8000/key \
  -H "Authorization: Bearer this.is.not.a.valid.token"
```

Expected response:
```
HTTP/1.1 403 Forbidden
{"detail":"Invalid or expired token: ..."}
```

### Obtain a valid token (demo credentials)

```bash
curl -s -X POST http://localhost:8000/token \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"polycode2024"}' | python3 -m json.tool
```

Expected response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 300
}
```

### Fetch the AES key with a valid token (should succeed)

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/token \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"polycode2024"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -i http://localhost:8000/key \
  -H "Authorization: Bearer $TOKEN"
```

Expected response:
```
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 16

<16 raw bytes of AES-128 key>
```

### What this proves

- `GET /key` without a token → **403**
- `GET /key` with a forged token → **403**
- `GET /key` with a valid token → **200 + key bytes**
- The encrypted `.ts` segments at `http://localhost:8082/hls/segment000.ts` are downloadable but **unplayable** without the key

---

## Regenerating the Encrypted Video (Optional)

If you want to re-encrypt a different video with the same key:

```bash
# From the repo root
AES_KEY_HEX=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 \
KEY_SERVER_URL=http://localhost:8000/key \
OUTPUT_DIR=./video-server/assets/hls \
bash ./scripts/encrypt-video.sh
```

Then rebuild only the video-server:
```bash
docker compose up --build video-server
```

---

## Troubleshooting

### Port already in use

```
Error: bind: address already in use
```

Another process is using port 3000, 8000, 8080, or 8082. Find and stop it:

```bash
# macOS / Linux
lsof -i :3000

# Windows (PowerShell)
netstat -ano | findstr :3000
```

Or change the host port in `docker-compose.yml` (e.g., `"3001:80"`).

---

### Stale containers / cached build

If you see unexpected behaviour after changing code:

```bash
docker compose down
docker compose up --build
```

To also remove volumes and cached images:
```bash
docker compose down --volumes --rmi local
docker compose up --build
```

---

### WebSocket connection refused

Symptom: the connection dot in Module 1A stays red.

- Confirm `realtime-server` started: `docker compose ps`
- Check logs: `docker compose logs realtime-server`
- Ensure nothing else occupies port 8080

---

### Video does not play in Module 1A

The default video (`/sample.mp4`) is generated at Docker build time. If the build step failed:

```bash
docker compose logs frontend
```

Look for `ffmpeg` output. If it errored, rebuild:
```bash
docker compose up --build frontend
```

Alternatively, paste any publicly accessible `.mp4` URL into the Video URL input.

---

### Module 2A: player shows "no key" or black screen

1. Confirm the key server is running: `curl http://localhost:8000/health`
2. Confirm the video server has segments: `curl -I http://localhost:8082/hls/stream.m3u8`
3. Check browser console for 403 errors — the token may have expired (TTL is 5 minutes). Click **Get Token** again in the player UI.

---

### Docker Compose version mismatch

The `version: '3.9'` field in `docker-compose.yml` requires Compose v2. If you have an older installation:

```bash
docker-compose --version   # should show 2.x
```

Upgrade Docker Desktop, or install the Compose plugin: https://docs.docker.com/compose/install/
