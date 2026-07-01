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
# http://localhost:4000
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
| Frontend | http://localhost:4000 | React app (all three modules) |
| Realtime server | ws://localhost:8080 | WebSocket endpoint (Module 1A) |
| Key server | http://localhost:8000 | Token issuance + AES key gate (Module 2A) |
| Video server | http://localhost:8082 | Encrypted HLS playlist and segments (Module 2A) |
| AI service | http://localhost:8001 | Whisper transcription, chapters, search, quiz (Module 3A) |
| Key server docs | http://localhost:8000/docs | FastAPI auto-generated OpenAPI UI |
| AI service docs | http://localhost:8001/docs | FastAPI auto-generated OpenAPI UI |

---

## Module 1A — Testing Multi-User Real-Time Sync

1. Open `http://localhost:4000` in Tab 1. A session ID is auto-generated (e.g., `a3f7b2c1`) and added to the URL as `?session=a3f7b2c1`.
2. Click **Copy Link** in the toolbar — it copies the full URL including the session ID.
3. Paste the copied URL into Tab 2. The session ID is read from the URL on load and Tab 2 auto-joins immediately.
4. Tab 2 receives a `sync` message with Tab 1's current state (if any).
5. Toggle **Drawing ON** in either tab and draw on the canvas.
6. The annotation appears in the other tab within milliseconds.
7. Post a comment — it appears in both tabs with its timestamp. Click it to seek the video.

Alternatively, join manually: enter a session ID in the input field and click **Join** (or press Enter). The URL updates to reflect the new session.

**Testing reconnect resync:**
1. Draw some strokes in Tab 1.
2. In Tab 2, open DevTools → Network → disable the WebSocket connection (or use DevTools to throttle offline briefly).
3. Re-enable. Tab 2 auto-reconnects and re-receives the full session state.

**Export:**
Click **Export JSON** in either tab. You receive a file like `session-a3f7b2c1.json` containing all strokes (with tool, color, coordinates) and comments (with text and video timestamp).

---

## End-to-End Demo — One Video Through All Three Modules (1A + 2A + 3A)

This is the flagship demo: one real video, encrypted (2A), annotated live by a team (1A), and automatically transcribed into clickable chapters (3A) — all from the 1A screen.

1. Open `http://localhost:4000` and stay on the **1A** tab.
2. In the video source bar, click **Load Secured Stream (2A)**.
3. The player automatically:
   - Posts demo credentials (`demo` / `polycode2024`) to the key server and receives a JWT
   - Initialises hls.js with the token injected on key requests (`Authorization: Bearer <token>`)
   - Loads `http://localhost:8082/hls/stream.m3u8` (the AES-128 encrypted stream)
4. The video source bar changes to a teal **"Secured stream active — AES-128 / Zero-Trust (2A)"** badge.
5. Toggle **Drawing ON** and annotate the secured video exactly as you would a plain video.
6. Switch to the **Chapters** tab in the side panel (next to Comments) and click **Analyze Video**.
   - If the secured stream isn't already loaded, this step loads it first — so annotating and analyzing always happen on the same video
   - The real pipeline runs (Whisper transcription, keyword extraction, summarization, chapter generation, translation) — takes roughly 10-15 seconds on the default demo clip
   - A chapter list appears in the panel, and matching tick marks appear on a timeline under the video
7. Click any chapter — the video seeks to that exact real moment (a genuine Whisper timestamp, not a guess).
8. Share the session link with a collaborator — they join and see your annotations in real time, on top of the same secured, transcribed stream.

To return to plain video, click **Switch to plain** in the source bar.

**Export includes everything**: clicking **Export JSON** downloads strokes, comments, *and* the analyzed chapters together in one file.

---

## Module 3A — Testing the AI Pipeline Standalone

The **3A — IA & Data** tab exposes the full pipeline output and a couple of extra features not shown in 1A's compact chapters panel.

1. Open `http://localhost:4000` and click the **3A** tab.
2. Click **Analyze Video**. First run takes ~10-15 seconds (Whisper transcription + keyword extraction + summarization + translation, all running live — not pre-computed).
3. You'll see: duration, word count, keyword count, chapter count, the full transcript, the LSA-generated summary, the English translation, keyword pills, and a chapter list.
4. **Search the Video** — type a topic or keyword and click **Search**. This runs semantic search (embedding similarity), not plain text match, so it can find conceptually related segments even without an exact word match.
5. **Generate Quiz** — click to generate quiz cards from the transcript, then **Show Answer** to reveal the full source sentence.

**Being clear about what's real AI here and what isn't:**
- Transcription and translation are genuine model inference (Whisper, Argos)
- Chapters use Whisper's real per-segment timestamps
- Keywords and the summary are classic extractive NLP (yake, sumy) — not generated text
- "Search the Video" and the quiz are both extractive too: they find or truncate real transcript sentences, they do not reason about your query or generate new content. Worth knowing before demoing them to judges as more than what they are.

**Proving the timestamps are real, not guessed:**
```bash
curl -s -X POST "http://localhost:8001/analyze?video_name=demo.mp4" | python3 -m json.tool
```
Check the `segments` array — each entry's `start`/`end` should land within the video's actual `duration` (also in the response), and roughly match where that sentence is audibly spoken if you scrub the video to that timestamp.

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

## Swapping the Demo Video

To replace the demo video everywhere (2A's encrypted stream, 3A's transcription source, and 1A's default plain video) with a different real video:

```bash
# From the repo root — same file, three destinations
cp your-video.mp4 video-server/video.mp4
cp your-video.mp4 ai-data/videos/demo.mp4
cp your-video.mp4 frontend/public/sample.mp4

docker compose up --build video-server ai-data frontend
```

No code changes needed — `video-server`'s `encrypt.sh` and `frontend`'s Dockerfile both auto-detect an existing file at that path and use it instead of generating a synthetic placeholder. `ai-data` just reads whatever is at `videos/demo.mp4` when `/analyze` is called.

**Keep it short (60-90s)**: 3A's transcription runs live, on click, not pre-computed — a much longer video means a much longer wait during a live demo. **Keep it in French** unless you also update `language="fr"` in `ai-data/pipeline/transcribe.py` and the `lan="fr"` / `Tokenizer("french")` settings in `keywords.py` / `summarize.py` — Whisper forced into French mode on non-French audio transcribes badly.

**Full model re-download only happens once**: `ai-data`'s Dockerfile bakes Whisper, Argos, and the sentence-transformer model in *before* copying application code or the video, specifically so that swapping the video (or editing a pipeline file) only re-runs the last few fast layers, not a multi-minute model re-download. If a rebuild after a video swap suddenly takes several minutes again, check that `ai-data/Dockerfile` still has the model-baking `RUN` steps ahead of the `COPY pipeline`, `COPY api`, and `COPY videos` lines — reordering them back to front reintroduces the slow rebuild.

If you only need to re-encrypt 2A's stream without touching 3A or 1A, the standalone script still works:
```bash
AES_KEY_HEX=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 \
KEY_SERVER_URL=http://localhost:8000/key \
OUTPUT_DIR=./video-server/assets/hls \
bash ./scripts/encrypt-video.sh

docker compose up --build video-server
```

---

## Troubleshooting

### Port already in use

```
Error: bind: address already in use
```

Another process is using port 4000, 8000, 8001, 8080, or 8082. Find and stop it:

```bash
# macOS / Linux
lsof -i :4000

# Windows (PowerShell)
netstat -ano | findstr :4000
```

Or change the host port in `docker-compose.yml` (e.g., `"4001:80"`).

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

### Module 3A: "Analyze Video" hangs, errors, or CORS fails

1. Confirm the AI service is running: `curl http://localhost:8001/health`
2. Check startup logs — `docker compose logs ai-data`. On first boot you should see `Application startup complete.`; if it's stuck earlier, a model failed to load.
3. First analysis after a fresh container start is normal to take ~10-15 seconds — there's no pre-computation, it's a live Whisper run. Longer than ~30s on the default clip suggests something is wrong, not just slow.
4. CORS errors in the browser console mean the frontend's origin isn't in `ai-data/api/app.py`'s `allow_origins` list — it currently allows `localhost:4000` and `localhost:5173`. Add your origin if you're serving the frontend elsewhere.
5. A `500` from `/quiz` or `/search` before ever calling `/analyze` is expected — those endpoints read a cached `outputs/{video_id}/metadata.json` that only exists after `/analyze` has run at least once against that container.

---

### Docker Compose version mismatch

The project uses the modern `docker compose` CLI (plugin, no dash). If you get `docker: 'compose' is not a docker command`:

```bash
docker-compose --version   # old standalone binary — should show 2.x
```

Upgrade Docker Desktop, or install the Compose plugin: https://docs.docker.com/compose/install/
