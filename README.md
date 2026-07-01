# Polycode

A hackathon project demonstrating real-time collaborative video annotation (1A), zero-trust encrypted video streaming (2A), and offline AI semantic indexing (3A), deployed as a single Docker Compose stack. All three modules are integrated around one real video: 2A encrypts it, 1A lets teams annotate it live, and 3A automatically transcribes it into searchable, clickable chapters — all from the same 1A screen.

---

# English

## Overview

Polycode contains three independent but related modules:

| Module | Name | What it demonstrates |
|--------|------|----------------------|
| 1A | Lecteur de Revue Augmenté | Live multi-user canvas annotations on top of a video, synced via WebSockets; URL-based session sharing |
| 2A | Architecture Zéro-Trust | AES-128 encrypted HLS video where every decryption key request is token-gated |
| 3A | IA & Data | Offline Whisper transcription, chapter extraction, keyword extraction, summarization, and fr→en translation of the same video |

All three share a single React frontend (tab-switched) and are integrated around one real video: 2A's "Load Secured Stream" button decrypts it, and 1A's "Analyze Video" button (which auto-triggers Load Secured Stream if needed, then calls 3A's pipeline) transcribes it into a chapter list layered right into the 1A screen, alongside the live annotation canvas. 2A and 3A also exist as standalone tabs for inspecting each module's mechanics in isolation. The entire stack starts with one command.

---

## Module 1A — Augmented Review Player

### What it does

Users open the same session ID in multiple browser tabs. They can:

- Draw freehand strokes, arrows, and rectangles on a Canvas overlay positioned over a video
- Post timestamped comments that, when clicked, seek the video to that moment
- See all other users' drawings appear in real time
- **Undo / Redo** individual strokes (`Ctrl+Z` / `Ctrl+Y`) — scoped to each client, broadcast to all
- **Temporal annotations** — strokes are linked to the current video timestamp and fade in/out as the video plays through that moment; this is the core innovation of the module
- **Live cursor tracking** — each participant's mouse position is visible on the canvas in real time, colour-coded by client
- **Playback sync** — play, pause and seek events are broadcast to all clients in the session so everyone watches the same frame simultaneously
- **Playback speed** — 0.25× to 2× controls for frame-by-frame annotation review
- Export the full session (strokes + comments) as a JSON file
- Share a session via URL — the session ID is stored in `?session=xxx`; clicking **Copy Link** copies the full shareable URL that auto-joins anyone who opens it
- Load the 2A encrypted stream directly in the 1A player — clicking **Load Secured Stream (2A)** auto-fetches a JWT from the key server, initialises hls.js with the token injected on key requests, and plays the AES-128 encrypted video under the annotation canvas
- **Analyze the video with AI (3A)** — clicking **Analyze Video** in the Chapters panel loads the secured stream (if not already playing) and runs it through 3A's Whisper pipeline, populating a chapter list and a tick-mark timeline under the video; clicking a chapter seeks to that exact real moment

### Why it is architected this way

**Canvas API over a third-party lib**: the HTML5 Canvas API gives pixel-level control over rendering without adding a large dependency. Drawing three shape types (pen, arrow, rect) needs ~100 lines of rendering code, not a library.

**Append-only stroke model**: every stroke has a unique ID and is appended to an in-memory array. Two users drawing simultaneously produce two independent strokes — there is no shared mutable cursor state, so there is no conflict to resolve. Undo removes a stroke by ID via a `removeStroke` message; the server filters it out and broadcasts the removal to all clients.

**Temporal annotations**: each stroke optionally carries a `videoTime` field. The canvas renders strokes with a time-based opacity — full opacity within 1 second of the stored timestamp, fading to zero at 3 seconds. The canvas runs a `requestAnimationFrame` loop so the fade is smooth without triggering React re-renders on every frame.

**WebSocket for sync**: HTTP polling would introduce latency and waste bandwidth. A persistent WebSocket connection broadcasts each stroke as soon as it is committed (mouse-up), achieving real-time sync with minimal overhead.

**Reconnect resync**: when a client reconnects after a dropped connection, it immediately sends a `join` message. The server responds with a `sync` message containing the complete current session state (all strokes and comments). The client re-renders from that snapshot. No data is lost from the other clients' perspective.

**URL-encoded session ID**: the session ID is stored in the URL as `?session=xxx` via `window.history.pushState`. Opening a shared URL auto-joins that session on load. No server-side routing is needed — the ID is read from `URLSearchParams` in the React component before the WebSocket connection is opened.

**1A/2A integration**: the 1A player includes a "Load Secured Stream (2A)" button. It posts to the key server with the demo credentials, receives a JWT, then initialises hls.js with `xhrSetup` to inject `Authorization: Bearer <token>` on every key request — exactly the same mechanism used in the standalone 2A player. The canvas overlay remains fully functional on top of the decrypted video stream.

**1A/3A integration**: rather than build a fourth, separate "unified" tab, 3A's chapter panel was added directly into 1A's existing side panel (a tab next to Comments). "Analyze Video" calls `loadSecuredStream()` first if the secured stream isn't already active, then `POST`s to 3A's `/analyze` endpoint — so the video being annotated and the video being transcribed are always the same one. Chapters use Whisper's real per-segment timestamps (see Module 3A below), not a computed guess, so clicking a chapter always seeks to where that sentence is genuinely spoken.

---

## Module 2A — Zero-Trust Video Streaming

### What it does

A video is packaged into HLS format with AES-128 segment encryption at build time. To watch it:

1. The player authenticates with the key server (`POST /token`) and receives a short-lived JWT (5 minutes).
2. The player loads the HLS playlist from Nginx. The playlist's `EXT-X-KEY` directive points to `http://localhost:8000/key`.
3. When hls.js needs to decrypt a segment, it fetches the key URI, injecting `Authorization: Bearer <token>` via `xhrSetup`.
4. The key server validates the token (signature + expiry). If valid, it returns the raw 16-byte AES key. If not, it returns **403 Forbidden**.
5. hls.js uses the key to decrypt the segment and plays it.

Without a valid token, `GET /key` always returns 403. The `.ts` segments themselves are opaque AES-128 ciphertext — downloading them directly yields unplayable data.

### Why this counts as real security, not cosmetic

| Property | What it means here |
|----------|--------------------|
| **Cryptographic key material** | The AES-128 key is a 16-byte secret. Without it, decryption is computationally infeasible. |
| **Signed tokens** | JWTs are signed with HMAC-SHA256. A forged or tampered token fails signature verification. |
| **Server-side expiry** | The `exp` claim is checked against the current UTC time on every key request. There is no way for a client to extend or replay an expired token. |
| **403 on any failure** | Missing token, wrong signature, expired token, malformed header — all return 403 with no key bytes. |
| **Key never in the playlist** | The `.m3u8` file contains only a URI pointing to the key server, not the key itself. Downloading the playlist reveals nothing decryptable. |

### The zero-trust principle

"Zero trust" means no network location is trusted by default. The video server (Nginx) serves encrypted segments to anyone — it has no authentication. The segments are safe to expose because they are encrypted. Trust is established **per-request** at the key server, not by controlling access to the segments.

---

## Module 3A — Semantic Indexing Pipeline

### What it does

A FastAPI service (`ai-data`) runs Whisper and a handful of classic NLP tools against the same video 2A encrypts, entirely offline:

1. **Transcribes** the audio with Whisper (`small` model), keeping each segment's real start/end timestamp
2. **Extracts keywords** with `yake`, a statistical keyword extractor (not a neural network)
3. **Summarizes** with `sumy`'s LSA algorithm — picks the 2 most representative existing sentences, does not generate new text
4. **Builds chapters** — one per real Whisper segment, so chapter timestamps always point at where something is actually said
5. **Translates** the transcript fr→en with Argos Translate, an offline neural MT engine

Two more endpoints support search: plain substring search, and embedding-based semantic search (`sentence-transformers`) that finds segments closest in *meaning* to a query, not just matching text. A "Search the Video" box and a "Generate Quiz" button expose these in the standalone 3A tab.

### Why it is architected this way

**Every model baked in at Docker build time**: Whisper, the Argos translation model, the sentence-transformer, and nltk's tokenizer data are all downloaded once during `docker build`, before any application code is copied in. The container needs zero network access at runtime — the same "no external accounts" constraint the whole project is built on. It also means editing a pipeline file or swapping the demo video doesn't force a multi-minute re-download of every model, because the Dockerfile copies application source and the video *after* the model-baking steps, not before.

**Real timestamps, not computed ones**: an earlier version of this pipeline computed every timestamp as `sentence_index × 30` — disconnected from the audio entirely, and wrong for any video not paced at exactly 30 seconds per sentence. Whisper already returns a real `start`/`end` per segment; the fix keeps that data instead of discarding it, and every downstream feature (chapters, search results, semantic search) reads real timestamps from it.

**Extractive, not generative, and labeled honestly**: the keyword extractor, summarizer, quiz, and "Search the Video" feature all operate on the video's *existing* sentences — finding, ranking, or truncating real content — rather than an LLM synthesizing new text. This is a deliberate scope choice (a real generative Q&A system would need a local LLM running offline, a meaningfully bigger and riskier addition) and the UI is worded to match: "Search the Video," not "Ask the AI," because that is what the feature actually does.

**No database**: each analysis is cached to a JSON file on disk (`outputs/{video_id}/metadata.json`), not a database row. See "The No-Database Decision" below.

**1A/2A/3A share one real video**: `video-server/video.mp4` (2A's encryption input) and `ai-data/videos/demo.mp4` (3A's transcription input) are kept as identical copies of the same file, and `frontend/public/sample.mp4` (1A's default, unauthenticated video) is the same file again. Encrypting, annotating, and transcribing the same content — rather than three different placeholder videos — is what makes the platform read as one coherent product instead of three disconnected demos.

---

## Architecture Diagrams

### Module 1A

```
  Browser Tab A                   Browser Tab B
       │                               │
       │  ws://localhost:8080          │  ws://localhost:8080
       └──────────────┬────────────────┘
                      │
              ┌───────▼──────────┐
              │  realtime-server │
              │  Node.js + ws    │
              │                  │
              │  sessions: Map{  │
              │    id → {        │
              │      strokes[]   │
              │      comments[]  │
              │      clients     │
              │    }             │
              │  }               │
              └──────────────────┘

Message flow:
  client  →  server:  { type: "join",         sessionId }
  server  →  client:  { type: "sync",         strokes, comments }
  client  →  server:  { type: "stroke",       data: Stroke }
  server  → others:   { type: "stroke",       data: Stroke }
  client  →  server:  { type: "comment",      data: Comment }
  server  → others:   { type: "comment",      data: Comment }
  client  →  server:  { type: "clear" }
  server  → others:   { type: "clear" }
  client  →  server:  { type: "removeStroke", strokeId }   ← undo/redo
  server  → others:   { type: "removeStroke", strokeId }
```

### Module 2A

```
  Browser (hls.js player)
       │
       ├─ POST /token  { username, password }
       │        │
       │   ┌────▼────────────────────┐
       │   │      key-server          │
       │   │  FastAPI + python-jose   │
       │   │  port 8000               │
       │   │                          │
       │   │  validates credentials   │
       │   │  issues JWT (TTL 5 min)  │
       │   └────────────────────────-─┘
       │        │
       │   ←── { access_token: "eyJ..." }
       │
       ├─ GET /hls/stream.m3u8
       │        │
       │   ┌────▼────────────────────┐
       │   │     video-server         │
       │   │  Nginx, port 8082        │
       │   │  serves .m3u8 + .ts      │
       │   └─────────────────────────┘
       │        │
       │   ←── playlist (EXT-X-KEY URI = http://localhost:8000/key)
       │
       ├─ GET /key   Authorization: Bearer <JWT>
       │        │
       │   ┌────▼────────────────────┐
       │   │      key-server          │
       │   │                          │
       │   │  verify signature ✓      │
       │   │  check exp ✓             │
       │   │  → 200 + AES key bytes   │
       │   │                          │
       │   │  any failure             │
       │   │  → 403 Forbidden         │
       │   └─────────────────────────┘
       │        │
       │   ←── 16 raw bytes (AES-128 key)
       │
       └─ hls.js decrypts segment → plays video
```

### Module 3A

```
  Browser (1A Chapters panel, or standalone 3A tab)
       │
       ├─ (1A only) loadSecuredStream() first, if not already active
       │
       ├─ POST /analyze?video_name=demo.mp4
       │        │
       │   ┌────▼──────────────────────────┐
       │   │         ai-data                │
       │   │  FastAPI, port 8001            │
       │   │                                │
       │   │  1. Whisper       → segments[] │
       │   │     { start, end, text }       │
       │   │  2. yake          → keywords[] │
       │   │  3. sumy (LSA)    → summary    │
       │   │  4. chapters.py   → chapters[] │
       │   │     (start = real segment.start)│
       │   │  5. Argos Translate → en text  │
       │   │                                │
       │   │  writes outputs/demo/          │
       │   │    metadata.json (cache)       │
       │   └───────────────────────────────┘
       │        │
       │   ←── { transcript, segments, chapters,
       │         keywords, summary, translation }
       │
       └─ render chapters; click one → seek video to
          chapters[i].start (a real Whisper timestamp)
```

### Full stack overview

```
  docker-compose up --build
  │
  ├── frontend        (port 4000)   React + Vite → Nginx static
  │     ├── /         → Module 1A tab (+ embedded 3A chapters)
  │     ├── /         → Module 2A tab (toggled)
  │     └── /         → Module 3A tab (toggled)
  │
  ├── realtime-server (port 8080)   Node.js WebSocket server
  │
  ├── key-server      (port 8000)   FastAPI token issuer + AES key gate
  │
  ├── video-server    (port 8082)   Nginx serving encrypted HLS
  │     └── /hls/stream.m3u8
  │     └── /hls/segment*.ts
  │
  └── ai-data         (port 8001)   FastAPI + Whisper + Argos + sentence-transformers
        └── /analyze, /search, /semantic-search, /ask, /quiz
```

---

## The No-Database Decision

This is an intentional design choice, not a shortcut.

**Module 1A — ephemeral sessions**: A collaborative review session is a live event, not a record. The meaningful artifact is the exported JSON snapshot (annotations + comments), which the user downloads explicitly. Storing strokes in a database would add schema design, migrations, a query layer, and connection pooling — none of which changes what the user experiences. The in-memory model is both simpler and correct for the use case.

**Module 2A — stateless tokens**: JWTs are self-contained. The key server does not need to look up anything: the token carries its own expiry (`exp`), subject (`sub`), and issue time (`iat`), all protected by the HMAC-SHA256 signature. A database lookup per key request would add latency and a single point of failure for no benefit. This is exactly the use case JWTs were designed for.

**Module 3A — a cache, not a database**: each `/analyze` call writes its result to `outputs/{video_id}/metadata.json` on the container's own filesystem. This is a cache of the last computed result for a video ID, not a persisted, queryable record — a fresh `ai-data` container starts with an empty `outputs/` folder until `/analyze` runs again. A real database would only be justified if the pipeline needed to serve many concurrent users analyzing many different videos with durable history across restarts, which is out of scope here.

**What would change this decision**: if sessions needed to survive server restarts, if the project required token revocation before expiry, or if 3A needed to serve many videos' worth of analysis history to many users, a persistence layer would be justified. None of those requirements exist here.

---

## Tech Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| Frontend | React + Vite | Canvas API access, hls.js integration, fast Docker builds |
| WebSocket server | Node.js + `ws` | Minimal dependency footprint; the protocol is simple enough to not need Socket.io |
| Key server | FastAPI + `python-jose` | python-jose is battle-tested for JWT; FastAPI gives async handling and OpenAPI docs for free |
| Video server | Nginx | Standard static HLS file server; CORS headers are two lines of config |
| HLS encryption | ffmpeg AES-128 (`hls_key_info_file`) | Industry standard; fully scriptable; reproducible in a Dockerfile |
| Speech-to-text | OpenAI Whisper (`small`, CPU) | Runs fully offline once baked into the image; no API key; good accuracy/speed balance for a 20-90s demo clip |
| Translation | Argos Translate | Offline neural MT; no API key; models installable at Docker build time |
| Semantic search | `sentence-transformers` (`all-MiniLM-L6-v2`) | Small, fast, CPU-friendly embedding model; no API key |
| Keyword extraction | `yake` | Statistical, unsupervised, no training data or API needed |
| Summarization | `sumy` (LSA) | Extractive, deterministic, no API needed — picks real sentences rather than generating new text |
| AI service | FastAPI | Same async framework as the key server; OpenAPI docs for free |
| Containerisation | Docker Compose | Single-command startup; no external accounts; identical on any machine |
| Styling | CSS Modules | Zero runtime cost; scoped class names; no build-time abstraction needed |

---
---

# Français

## Vue d'ensemble

Polycode contient trois modules indépendants mais complémentaires :

| Module | Nom | Ce qu'il démontre |
|--------|-----|-------------------|
| 1A | Lecteur de Revue Augmenté | Annotations collaboratives en temps réel sur une vidéo via WebSockets ; sessions partageables par URL |
| 2A | Architecture Zéro-Trust | Streaming HLS chiffré AES-128, chaque clé de déchiffrement étant protégée par un token |
| 3A | IA & Data | Transcription Whisper hors-ligne, extraction de chapitres et de mots-clés, résumé, et traduction fr→en de la même vidéo |

Les trois modules partagent un seul frontend React (navigation par onglets) et sont intégrés autour d'une seule vraie vidéo : le bouton "Load Secured Stream" du module 2A la déchiffre, et le bouton "Analyze Video" du module 1A (qui déclenche automatiquement Load Secured Stream si nécessaire, puis appelle le pipeline du module 3A) la transcrit en une liste de chapitres intégrée directement dans l'écran 1A, aux côtés du canvas d'annotation en direct. Les modules 2A et 3A existent aussi en onglets autonomes pour inspecter le mécanisme de chaque module isolément. L'ensemble du stack démarre avec une seule commande.

---

## Module 1A — Lecteur de Revue Augmenté

### Ce que ça fait

Les utilisateurs ouvrent le même identifiant de session dans plusieurs onglets du navigateur. Ils peuvent :

- Dessiner des traits libres, des flèches et des rectangles sur une couche Canvas superposée à la vidéo
- Poster des commentaires horodatés qui, une fois cliqués, font avancer la vidéo au bon moment
- Voir en temps réel les dessins de tous les autres utilisateurs
- **Annuler / Rétablir** des traits individuels (`Ctrl+Z` / `Ctrl+Y`) — limité aux traits du client courant, diffusé à tous
- **Annotations temporelles** — les traits sont liés au timestamp vidéo courant et apparaissent/disparaissent progressivement selon la position de lecture ; c'est l'innovation principale du module
- **Curseurs en temps réel** — la position de la souris de chaque participant est visible sur le canvas, avec une couleur distincte par client
- **Synchronisation de lecture** — play, pause et seek sont diffusés à tous les clients pour que chacun regarde la même image simultanément
- **Contrôle de vitesse** — de 0.25× à 2× pour annoter image par image
- Exporter la session complète (traits + commentaires) sous forme de fichier JSON
- Partager une session par URL — l'identifiant de session est stocké dans `?session=xxx` ; cliquer sur **Copy Link** copie l'URL complète qui rejoint automatiquement la session
- Charger le flux chiffré 2A directement dans le lecteur 1A — le bouton **Load Secured Stream (2A)** récupère automatiquement un JWT du serveur de clés, initialise hls.js avec le token injecté sur les requêtes de clé, et joue la vidéo AES-128 chiffrée sous la couche d'annotation
- **Analyser la vidéo avec l'IA (3A)** — cliquer sur **Analyze Video** dans le panneau Chapters charge le flux sécurisé (s'il n'est pas déjà actif) et le fait passer par le pipeline Whisper du module 3A, remplissant une liste de chapitres et une frise chronologique sous la vidéo ; cliquer sur un chapitre fait avancer la vidéo à ce moment précis

### Pourquoi cette architecture

**Canvas API plutôt qu'une bibliothèque tierce** : l'API Canvas HTML5 donne un contrôle pixel par pixel sur le rendu sans ajouter de dépendance lourde. Dessiner trois types de formes (stylo, flèche, rectangle) ne nécessite qu'une centaine de lignes de code de rendu.

**Modèle de traits en ajout seul** : chaque trait possède un identifiant unique et est ajouté à un tableau en mémoire. Deux utilisateurs qui dessinent simultanément produisent deux traits indépendants — il n'y a pas d'état mutable partagé, donc pas de conflit à résoudre. L'annulation supprime un trait par identifiant via un message `removeStroke` ; le serveur le filtre et diffuse la suppression à tous les clients.

**Annotations temporelles** : chaque trait porte optionnellement un champ `videoTime`. Le canvas calcule une opacité par trait selon la distance temporelle — pleine opacité à moins d'une seconde du timestamp, fondu jusqu'à zéro à trois secondes. Le rendu tourne en boucle `requestAnimationFrame` pour que le fondu soit fluide sans déclencher de re-rendus React à chaque frame.

**WebSocket pour la synchronisation** : le polling HTTP introduirait de la latence et du gaspillage de bande passante. Une connexion WebSocket persistante diffuse chaque trait dès qu'il est validé (relâchement du bouton souris), assurant une synchronisation en temps réel avec un minimum de surcharge.

**Resynchronisation à la reconnexion** : quand un client se reconnecte après une coupure, il envoie immédiatement un message `join`. Le serveur répond avec un message `sync` contenant l'état complet de la session (tous les traits et commentaires). Le client re-rend depuis ce snapshot. Aucune donnée n'est perdue.

**Identifiant de session dans l'URL** : l'identifiant de session est stocké dans l'URL via `?session=xxx` (`window.history.pushState`). Ouvrir un lien partagé rejoint automatiquement la session au chargement. Aucun routage côté serveur n'est nécessaire — l'identifiant est lu dans `URLSearchParams` dans le composant React avant l'ouverture de la connexion WebSocket.

**Intégration 1A/2A** : le lecteur 1A inclut un bouton "Load Secured Stream (2A)". Il envoie une requête `POST /token` au serveur de clés avec les identifiants de démonstration, reçoit un JWT, puis initialise hls.js avec `xhrSetup` pour injecter `Authorization: Bearer <token>` sur chaque requête de clé — exactement le même mécanisme que dans le lecteur 2A autonome. La couche Canvas reste pleinement fonctionnelle sur le flux vidéo déchiffré.

**Intégration 1A/3A** : plutôt que de créer un quatrième onglet "unifié" séparé, le panneau de chapitres du module 3A a été ajouté directement dans le panneau latéral existant du module 1A (un onglet à côté de Comments). "Analyze Video" appelle d'abord `loadSecuredStream()` si le flux sécurisé n'est pas déjà actif, puis envoie une requête `POST` vers l'endpoint `/analyze` du module 3A — la vidéo annotée et la vidéo transcrite sont donc toujours la même. Les chapitres utilisent les horodatages réels par segment de Whisper (voir Module 3A ci-dessous), pas une estimation calculée, donc cliquer sur un chapitre fait toujours avancer la vidéo à l'endroit où cette phrase est réellement prononcée.

---

## Module 2A — Architecture Zéro-Trust

### Ce que ça fait

Une vidéo est empaquetée au format HLS avec chiffrement AES-128 des segments au moment du build. Pour la regarder :

1. Le lecteur s'authentifie auprès du serveur de clés (`POST /token`) et reçoit un JWT de courte durée (5 minutes).
2. Le lecteur charge la playlist HLS depuis Nginx. La directive `EXT-X-KEY` de la playlist pointe vers `http://localhost:8000/key`.
3. Quand hls.js doit déchiffrer un segment, il récupère l'URI de la clé en injectant `Authorization: Bearer <token>` via `xhrSetup`.
4. Le serveur de clés valide le token (signature + expiration). Si valide, il retourne les 16 octets bruts de la clé AES. Sinon, il renvoie **403 Forbidden**.
5. hls.js utilise la clé pour déchiffrer le segment et joue la vidéo.

Sans token valide, `GET /key` renvoie systématiquement 403. Les segments `.ts` eux-mêmes sont du texte chiffré AES-128 opaque — les télécharger directement produit des données illisibles.

### Pourquoi c'est une vraie sécurité, pas cosmétique

| Propriété | Ce que ça signifie ici |
|-----------|------------------------|
| **Matériel cryptographique** | La clé AES-128 est un secret de 16 octets. Sans elle, le déchiffrement est computationnellement infaisable. |
| **Tokens signés** | Les JWT sont signés avec HMAC-SHA256. Un token forgé ou modifié échoue à la vérification de signature. |
| **Expiration côté serveur** | Le claim `exp` est vérifié contre l'heure UTC actuelle à chaque requête de clé. Il est impossible pour un client d'étendre ou de rejouer un token expiré. |
| **403 sur tout échec** | Token manquant, mauvaise signature, token expiré, en-tête malformé — tout renvoie 403 sans octets de clé. |
| **Clé jamais dans la playlist** | Le fichier `.m3u8` contient uniquement un URI pointant vers le serveur de clés, pas la clé elle-même. Télécharger la playlist ne révèle rien de déchiffrable. |

### Le principe zéro-trust

« Zéro confiance » signifie qu'aucun emplacement réseau n'est fiable par défaut. Le serveur vidéo (Nginx) sert des segments chiffrés à tout le monde — il n'a pas d'authentification. Les segments sont sûrs à exposer parce qu'ils sont chiffrés. La confiance est établie **par requête** au niveau du serveur de clés, pas en contrôlant l'accès aux segments.

---

## Module 3A — Pipeline d'Indexation Sémantique

### Ce que ça fait

Un service FastAPI (`ai-data`) exécute Whisper et quelques outils NLP classiques sur la même vidéo que le module 2A chiffre, entièrement hors-ligne :

1. **Transcrit** l'audio avec Whisper (modèle `small`), en conservant l'horodatage réel de début/fin de chaque segment
2. **Extrait des mots-clés** avec `yake`, un extracteur statistique (pas un réseau de neurones)
3. **Résume** avec l'algorithme LSA de `sumy` — sélectionne les 2 phrases existantes les plus représentatives, ne génère pas de nouveau texte
4. **Construit des chapitres** — un par segment Whisper réel, donc les horodatages des chapitres pointent toujours vers un moment où quelque chose est réellement dit
5. **Traduit** la transcription du français vers l'anglais avec Argos Translate, un moteur de traduction neuronale hors-ligne

Deux endpoints supplémentaires permettent la recherche : recherche textuelle simple, et recherche sémantique par embeddings (`sentence-transformers`) qui trouve les segments les plus proches en *sens* d'une requête, pas seulement par correspondance textuelle. Un champ "Search the Video" et un bouton "Generate Quiz" exposent ces fonctions dans l'onglet 3A autonome.

### Pourquoi cette architecture

**Tous les modèles intégrés au moment du build Docker** : Whisper, le modèle de traduction Argos, le sentence-transformer et les données de tokenisation nltk sont tous téléchargés une seule fois pendant `docker build`, avant que le code applicatif ne soit copié. Le conteneur n'a besoin d'aucun accès réseau à l'exécution — la même contrainte « aucun compte externe » sur laquelle repose tout le projet. Cela signifie aussi que modifier un fichier du pipeline ou changer la vidéo de démonstration ne force pas un nouveau téléchargement de plusieurs minutes de tous les modèles, car le Dockerfile copie le code source applicatif et la vidéo *après* les étapes d'intégration des modèles, pas avant.

**Des horodatages réels, pas calculés** : une version antérieure de ce pipeline calculait chaque horodatage comme `index_de_phrase × 30` — complètement déconnecté de l'audio, et faux pour toute vidéo qui n'est pas rythmée exactement à 30 secondes par phrase. Whisper renvoie déjà un `start`/`end` réel par segment ; le correctif conserve cette donnée au lieu de la jeter, et chaque fonctionnalité en aval (chapitres, résultats de recherche, recherche sémantique) lit des horodatages réels depuis cette donnée.

**Extractif, pas génératif, et nommé honnêtement** : l'extracteur de mots-clés, le résumeur, le quiz et la fonction "Search the Video" opèrent tous sur les phrases *existantes* de la vidéo — en trouvant, classant ou tronquant du contenu réel — plutôt qu'une IA générative qui synthétiserait du nouveau texte. C'est un choix de périmètre délibéré (un vrai système de questions-réponses génératif nécessiterait un LLM local fonctionnant hors-ligne, un ajout significativement plus lourd et plus risqué) et l'interface est nommée en conséquence : "Search the Video", pas "Ask the AI", parce que c'est exactement ce que fait la fonctionnalité.

**Pas de base de données** : chaque analyse est mise en cache dans un fichier JSON sur disque (`outputs/{video_id}/metadata.json`), pas une ligne de base de données. Voir « La décision sans base de données » ci-dessous.

**1A/2A/3A partagent une seule vraie vidéo** : `video-server/video.mp4` (l'entrée de chiffrement du module 2A) et `ai-data/videos/demo.mp4` (l'entrée de transcription du module 3A) sont maintenus comme des copies identiques du même fichier, et `frontend/public/sample.mp4` (la vidéo par défaut, non authentifiée, du module 1A) est à nouveau ce même fichier. Chiffrer, annoter et transcrire le même contenu — plutôt que trois vidéos placeholder différentes — c'est ce qui fait que la plateforme se lit comme un seul produit cohérent plutôt que trois démos déconnectées.

---

## Diagrammes d'architecture

### Module 1A

```
  Onglet A du navigateur          Onglet B du navigateur
       │                               │
       │  ws://localhost:8080          │  ws://localhost:8080
       └──────────────┬────────────────┘
                      │
              ┌───────▼──────────┐
              │  realtime-server │
              │  Node.js + ws    │
              │                  │
              │  sessions: Map{  │
              │    id → {        │
              │      strokes[]   │
              │      comments[]  │
              │      clients     │
              │    }             │
              │  }               │
              └──────────────────┘

Flux de messages :
  client  →  serveur :  { type: "join",         sessionId }
  serveur →  client  :  { type: "sync",         strokes, comments }
  client  →  serveur :  { type: "stroke",       data: Stroke }
  serveur → autres   :  { type: "stroke",       data: Stroke }
  client  →  serveur :  { type: "comment",      data: Comment }
  serveur → autres   :  { type: "comment",      data: Comment }
  client  →  serveur :  { type: "clear" }
  serveur → autres   :  { type: "clear" }
  client  →  serveur :  { type: "removeStroke", strokeId }   ← annuler/rétablir
  serveur → autres   :  { type: "removeStroke", strokeId }
```

### Module 2A

```
  Navigateur (lecteur hls.js)
       │
       ├─ POST /token  { username, password }
       │        │
       │   ┌────▼────────────────────┐
       │   │      key-server          │
       │   │  FastAPI + python-jose   │
       │   │  port 8000               │
       │   │                          │
       │   │  valide les identifiants │
       │   │  émet un JWT (TTL 5 min) │
       │   └─────────────────────────┘
       │        │
       │   ←── { access_token: "eyJ..." }
       │
       ├─ GET /hls/stream.m3u8
       │        │
       │   ┌────▼────────────────────┐
       │   │     video-server         │
       │   │  Nginx, port 8082        │
       │   │  sert .m3u8 + .ts        │
       │   └─────────────────────────┘
       │        │
       │   ←── playlist (EXT-X-KEY URI = http://localhost:8000/key)
       │
       ├─ GET /key   Authorization: Bearer <JWT>
       │        │
       │   ┌────▼────────────────────┐
       │   │      key-server          │
       │   │                          │
       │   │  vérifie signature ✓     │
       │   │  vérifie exp ✓           │
       │   │  → 200 + octets clé AES  │
       │   │                          │
       │   │  tout échec              │
       │   │  → 403 Forbidden         │
       │   └─────────────────────────┘
       │        │
       │   ←── 16 octets bruts (clé AES-128)
       │
       └─ hls.js déchiffre le segment → lecture vidéo
```

### Module 3A

```
  Navigateur (panneau Chapters du module 1A, ou onglet 3A autonome)
       │
       ├─ (1A uniquement) loadSecuredStream() d'abord, si pas déjà actif
       │
       ├─ POST /analyze?video_name=demo.mp4
       │        │
       │   ┌────▼──────────────────────────┐
       │   │         ai-data                │
       │   │  FastAPI, port 8001            │
       │   │                                │
       │   │  1. Whisper       → segments[] │
       │   │     { start, end, text }       │
       │   │  2. yake          → keywords[] │
       │   │  3. sumy (LSA)    → summary    │
       │   │  4. chapters.py   → chapters[] │
       │   │     (start = segment.start réel)│
       │   │  5. Argos Translate → texte en │
       │   │                                │
       │   │  écrit outputs/demo/           │
       │   │    metadata.json (cache)       │
       │   └───────────────────────────────┘
       │        │
       │   ←── { transcript, segments, chapters,
       │         keywords, summary, translation }
       │
       └─ affiche les chapitres ; cliquer sur l'un → avance la
          vidéo à chapters[i].start (un horodatage Whisper réel)
```

### Vue d'ensemble du stack complet

```
  docker-compose up --build
  │
  ├── frontend        (port 4000)   React + Vite → Nginx statique
  │     ├── /         → Onglet Module 1A (+ chapitres 3A intégrés)
  │     ├── /         → Onglet Module 2A (basculé)
  │     └── /         → Onglet Module 3A (basculé)
  │
  ├── realtime-server (port 8080)   Serveur WebSocket Node.js
  │
  ├── key-server      (port 8000)   Émetteur de tokens + porte de clé AES FastAPI
  │
  ├── video-server    (port 8082)   Nginx servant le HLS chiffré
  │     └── /hls/stream.m3u8
  │     └── /hls/segment*.ts
  │
  └── ai-data         (port 8001)   FastAPI + Whisper + Argos + sentence-transformers
        └── /analyze, /search, /semantic-search, /ask, /quiz
```

---

## La décision sans base de données

C'est un choix de conception intentionnel, pas un raccourci.

**Module 1A — sessions éphémères** : une session de revue collaborative est un événement en direct, pas un enregistrement. L'artefact significatif est le snapshot JSON exporté (annotations + commentaires), que l'utilisateur télécharge explicitement. Stocker les traits dans une base de données ajouterait de la conception de schéma, des migrations, une couche de requêtes et du connection pooling — aucun de ces éléments ne change l'expérience utilisateur. Le modèle en mémoire est à la fois plus simple et correct pour ce cas d'usage.

**Module 2A — tokens sans état** : les JWT sont auto-contenus. Le serveur de clés n'a rien à rechercher : le token porte sa propre expiration (`exp`), son sujet (`sub`) et son heure d'émission (`iat`), tous protégés par la signature HMAC-SHA256. Une recherche en base par requête de clé ajouterait de la latence et un point de défaillance unique sans bénéfice. C'est exactement le cas d'usage pour lequel les JWT ont été conçus.

**Module 3A — un cache, pas une base de données** : chaque appel à `/analyze` écrit son résultat dans `outputs/{video_id}/metadata.json` sur le système de fichiers du conteneur. C'est un cache du dernier résultat calculé pour un identifiant de vidéo, pas un enregistrement persistant et interrogeable — un conteneur `ai-data` neuf démarre avec un dossier `outputs/` vide jusqu'à ce que `/analyze` soit rappelé. Une vraie base de données ne serait justifiée que si le pipeline devait servir de nombreux utilisateurs simultanés analysant de nombreuses vidéos différentes avec un historique durable entre les redémarrages, ce qui dépasse le périmètre ici.

**Ce qui changerait cette décision** : si les sessions devaient survivre aux redémarrages du serveur, si le projet nécessitait la révocation de tokens avant expiration, ou si le module 3A devait servir un historique d'analyses de nombreuses vidéos à de nombreux utilisateurs, une couche de persistance serait justifiée. Aucune de ces exigences n'existe ici.

---

## Stack technique

| Composant | Technologie | Raison |
|-----------|-------------|--------|
| Frontend | React + Vite | Accès à l'API Canvas, intégration hls.js, builds Docker rapides |
| Serveur WebSocket | Node.js + `ws` | Empreinte minimale ; le protocole est assez simple pour ne pas nécessiter Socket.io |
| Serveur de clés | FastAPI + `python-jose` | python-jose est éprouvé pour JWT ; FastAPI offre la gestion async et la doc OpenAPI gratuitement |
| Serveur vidéo | Nginx | Serveur de fichiers HLS statiques standard ; les en-têtes CORS se configurent en deux lignes |
| Chiffrement HLS | ffmpeg AES-128 (`hls_key_info_file`) | Standard industriel ; entièrement scriptable ; reproductible dans un Dockerfile |
| Reconnaissance vocale | OpenAI Whisper (`small`, CPU) | Fonctionne entièrement hors-ligne une fois intégré à l'image ; pas de clé API ; bon équilibre précision/vitesse pour un clip de démo de 20-90s |
| Traduction | Argos Translate | Traduction neuronale hors-ligne ; pas de clé API ; modèles installables au moment du build Docker |
| Recherche sémantique | `sentence-transformers` (`all-MiniLM-L6-v2`) | Modèle d'embedding petit, rapide, adapté au CPU ; pas de clé API |
| Extraction de mots-clés | `yake` | Statistique, non supervisé, ne nécessite ni données d'entraînement ni API |
| Résumé | `sumy` (LSA) | Extractif, déterministe, ne nécessite pas d'API — sélectionne de vraies phrases plutôt que d'en générer de nouvelles |
| Service IA | FastAPI | Même framework async que le serveur de clés ; documentation OpenAPI gratuite |
| Conteneurisation | Docker Compose | Démarrage en une commande ; aucun compte externe ; identique sur toute machine |
| Styles | CSS Modules | Coût d'exécution nul ; noms de classes scopés ; aucune abstraction au build |
