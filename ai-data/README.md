# ai-data — Semantic Indexing Pipeline (Module 3A)

FastAPI service that transcribes the platform's demo video with Whisper and derives chapters, keywords, a summary, an English translation, a searchable index, and a quiz — entirely offline, no cloud API keys, no external accounts.

See the root [README.md](../README.md) for how this fits into the full Polycode architecture, and [SETUP.md](../SETUP.md) for how to run and test it.

---

## What it does

`POST /analyze` runs the full pipeline against `videos/demo.mp4`:

1. **Transcribe** (`pipeline/transcribe.py`) — Whisper (`small` model) converts the audio to text, keeping each segment's real `start`/`end` timestamp (in seconds) and the video's real duration.
2. **Extract keywords** (`pipeline/keywords.py`) — `yake` pulls the most significant French phrases out of the transcript, filtered against a small stopword list of filler words (bonjour, merci, etc.).
3. **Summarize** (`pipeline/summarize.py`) — `sumy`'s LSA summarizer picks the 2 most representative sentences from the transcript. Extractive, not generative — it selects real sentences, it does not write new ones.
4. **Generate chapters** (`pipeline/chapters.py`) — one chapter per Whisper segment, using that segment's real `start` time. This is the piece that was originally broken in an earlier version of this pipeline (see "Why timestamps are real" below) and was fixed before merging into the main stack.
5. **Translate** (`pipeline/translate.py`) — Argos Translate (offline neural MT, fr→en) translates the transcript.

Two more endpoints run independently of `/analyze`, against whatever the last `/analyze` call cached to disk:

- `GET /search?video_id=&query=` — plain substring search over Whisper segments (`pipeline/search.py`)
- `GET /semantic-search?video_id=&query=` — embedding-based search using `sentence-transformers` (`all-MiniLM-L6-v2`) to find the segments closest in meaning to the query, not just matching text (`pipeline/semantic_search.py`)
- `GET /ask?video_id=&question=` — runs semantic search, then stitches the resulting segments together behind a fixed French template sentence (`pipeline/qa.py`). **This is not a generative Q&A system** — it does not read your question and reason about an answer, it returns the most semantically relevant existing sentences. The frontend labels this feature "Search the Video," not "Ask the AI," for exactly this reason.
- `GET /quiz?video_id=` — turns the first 5 transcript sentences into quiz cards with a templated French question and the full sentence as the answer (`pipeline/quiz.py`). Also extractive/templated, not generated.

---

## Why timestamps are real, not computed

The version of this pipeline originally written for the AI pole computed every timestamp as `sentence_index × 30` — a guess, completely disconnected from where anything was actually said in the audio. On a video shorter than a few minutes this produces chapters and search results pointing past the end of the clip.

Whisper already returns a real `start`/`end` per segment (`result["segments"]` in `transcribe.py`). The fix was to keep that data instead of discarding it: `transcribe_video()` stores `segments: [{start, end, text}]` in `metadata.json`, and `chapters.py` / `search.py` / `semantic_search.py` all read `start` directly from there. `duration` is likewise computed as the last segment's `end` time, rather than being hardcoded to `0`.

---

## Why everything is baked into the Docker image at build time

`Dockerfile` downloads and caches every model during `docker build`, before any application code is copied in:

- Whisper `small` (~461 MB)
- The Argos Translate fr→en package
- `sentence-transformers/all-MiniLM-L6-v2`
- nltk's `punkt` / `punkt_tab` tokenizer data (needed by `sumy`'s French tokenizer)

This means the container needs **zero network access at runtime** — consistent with the rest of Polycode's "no external accounts, works fully offline" constraint. It also means `docker compose up --build` is the only setup step; nothing needs to be downloaded manually.

The Dockerfile deliberately orders these `RUN` steps *before* the `COPY pipeline`, `COPY api`, etc. steps, and before `COPY videos`. Docker invalidates a layer's cache — and every layer after it — as soon as any input to that layer changes. Since none of the model-baking steps actually depend on the application source or the demo video, keeping them first means editing a pipeline file or swapping the demo video only invalidates the cheap, fast layers at the end of the build, not a multi-minute re-download of every model.

---

## Why French

`transcribe_video()` forces `language="fr"`, and `keywords.py` / `summarize.py` are configured for French (`yake(lan="fr")`, `sumy Tokenizer("french")`). This matches the actual demo video's narration. Feeding this pipeline an English video without changing these three settings will produce degraded transcription — Whisper forced into French mode on non-French audio does not work well.

---

## Why no database

Each `/analyze` call writes its result to `outputs/{video_id}/metadata.json` on the container's local filesystem — a cache of the last computed result, not a database. There's no schema, no query layer, no persistence across container rebuilds (a fresh `ai-data` image starts with an empty `outputs/` folder until `/analyze` is called again). This is intentional: the meaningful state is "the last video someone analyzed," which a single JSON file per video ID represents perfectly well. A real database would only be justified if this needed to serve many concurrent users analyzing many different videos with durable history — out of scope for a hackathon demo of one pipeline.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/analyze?video_name=demo.mp4` | Runs the full pipeline, returns the complete metadata object |
| `GET` | `/search?video_id=demo&query=...` | Plain text search over transcript segments |
| `GET` | `/semantic-search?video_id=demo&query=...` | Embedding-based search over transcript segments |
| `GET` | `/ask?video_id=demo&question=...` | Semantic search + templated answer (not generative) |
| `GET` | `/quiz?video_id=demo` | Templated quiz cards from the first 5 sentences |

CORS is open to `localhost:4000` (the Dockerized frontend) and `localhost:5173` (Vite dev server).

---

## Local structure

```
ai-data/
├── api/app.py              FastAPI app, all routes
├── pipeline/
│   ├── transcribe.py       Whisper — real segments + duration
│   ├── keywords.py         yake keyword extraction
│   ├── summarize.py        sumy LSA extractive summary
│   ├── chapters.py         one chapter per real Whisper segment
│   ├── translate.py        Argos Translate fr→en
│   ├── search.py           substring search
│   ├── semantic_search.py  embedding search (sentence-transformers)
│   ├── qa.py                semantic search + template answer
│   ├── quiz.py              templated quiz cards
│   └── analyzer.py         orchestrates the pipeline above
├── utils/metadata_manager.py   writes/reads outputs/{video_id}/metadata.json
├── videos/demo.mp4         the source video (see root README for how this is kept
│                            in sync with video-server's encrypted copy)
├── install_argos.py        run once at build time to fetch the fr→en model
├── requirements.txt
└── Dockerfile
```
