# Polycode

A hackathon project demonstrating real-time collaborative video annotation (1A) and zero-trust encrypted video streaming (2A), deployed as a single Docker Compose stack. The two modules are integrated: the 1A player can load the 2A encrypted stream directly, and sessions are shareable via URL.

---

# English

## Overview

Polycode contains two independent but related modules:

| Module | Name | What it demonstrates |
|--------|------|----------------------|
| 1A | Lecteur de Revue Augmenté | Live multi-user canvas annotations on top of a video, synced via WebSockets; URL-based session sharing |
| 2A | Architecture Zéro-Trust | AES-128 encrypted HLS video where every decryption key request is token-gated |

Both modules share a single React frontend (tab-switched) and are integrated: the 1A player can load the 2A encrypted stream in one click, creating an end-to-end secure annotation workflow. The entire stack starts with one command.

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

### Why it is architected this way

**Canvas API over a third-party lib**: the HTML5 Canvas API gives pixel-level control over rendering without adding a large dependency. Drawing three shape types (pen, arrow, rect) needs ~100 lines of rendering code, not a library.

**Append-only stroke model**: every stroke has a unique ID and is appended to an in-memory array. Two users drawing simultaneously produce two independent strokes — there is no shared mutable cursor state, so there is no conflict to resolve. Undo removes a stroke by ID via a `removeStroke` message; the server filters it out and broadcasts the removal to all clients.

**Temporal annotations**: each stroke optionally carries a `videoTime` field. The canvas renders strokes with a time-based opacity — full opacity within 1 second of the stored timestamp, fading to zero at 3 seconds. The canvas runs a `requestAnimationFrame` loop so the fade is smooth without triggering React re-renders on every frame.

**WebSocket for sync**: HTTP polling would introduce latency and waste bandwidth. A persistent WebSocket connection broadcasts each stroke as soon as it is committed (mouse-up), achieving real-time sync with minimal overhead.

**Reconnect resync**: when a client reconnects after a dropped connection, it immediately sends a `join` message. The server responds with a `sync` message containing the complete current session state (all strokes and comments). The client re-renders from that snapshot. No data is lost from the other clients' perspective.

**URL-encoded session ID**: the session ID is stored in the URL as `?session=xxx` via `window.history.pushState`. Opening a shared URL auto-joins that session on load. No server-side routing is needed — the ID is read from `URLSearchParams` in the React component before the WebSocket connection is opened.

**1A/2A integration**: the 1A player includes a "Load Secured Stream (2A)" button. It posts to the key server with the demo credentials, receives a JWT, then initialises hls.js with `xhrSetup` to inject `Authorization: Bearer <token>` on every key request — exactly the same mechanism used in the standalone 2A player. The canvas overlay remains fully functional on top of the decrypted video stream.

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

### Full stack overview

```
  docker-compose up --build
  │
  ├── frontend        (port 4000)   React + Vite → Nginx static
  │     ├── /         → Module 1A tab
  │     └── /         → Module 2A tab (toggled)
  │
  ├── realtime-server (port 8080)   Node.js WebSocket server
  │
  ├── key-server      (port 8000)   FastAPI token issuer + AES key gate
  │
  └── video-server    (port 8082)   Nginx serving encrypted HLS
        └── /hls/stream.m3u8
        └── /hls/segment*.ts
```

---

## The No-Database Decision

This is an intentional design choice, not a shortcut.

**Module 1A — ephemeral sessions**: A collaborative review session is a live event, not a record. The meaningful artifact is the exported JSON snapshot (annotations + comments), which the user downloads explicitly. Storing strokes in a database would add schema design, migrations, a query layer, and connection pooling — none of which changes what the user experiences. The in-memory model is both simpler and correct for the use case.

**Module 2A — stateless tokens**: JWTs are self-contained. The key server does not need to look up anything: the token carries its own expiry (`exp`), subject (`sub`), and issue time (`iat`), all protected by the HMAC-SHA256 signature. A database lookup per key request would add latency and a single point of failure for no benefit. This is exactly the use case JWTs were designed for.

**What would change this decision**: if sessions needed to survive server restarts, or if the project required token revocation before expiry, a persistence layer would be justified. Neither requirement exists here.

---

## Tech Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| Frontend | React + Vite | Canvas API access, hls.js integration, fast Docker builds |
| WebSocket server | Node.js + `ws` | Minimal dependency footprint; the protocol is simple enough to not need Socket.io |
| Key server | FastAPI + `python-jose` | python-jose is battle-tested for JWT; FastAPI gives async handling and OpenAPI docs for free |
| Video server | Nginx | Standard static HLS file server; CORS headers are two lines of config |
| HLS encryption | ffmpeg AES-128 (`hls_key_info_file`) | Industry standard; fully scriptable; reproducible in a Dockerfile |
| Containerisation | Docker Compose | Single-command startup; no external accounts; identical on any machine |
| Styling | CSS Modules | Zero runtime cost; scoped class names; no build-time abstraction needed |

---
---

# Français

## Vue d'ensemble

Polycode contient deux modules indépendants mais complémentaires :

| Module | Nom | Ce qu'il démontre |
|--------|-----|-------------------|
| 1A | Lecteur de Revue Augmenté | Annotations collaboratives en temps réel sur une vidéo via WebSockets ; sessions partageables par URL |
| 2A | Architecture Zéro-Trust | Streaming HLS chiffré AES-128, chaque clé de déchiffrement étant protégée par un token |

Les deux modules partagent un seul frontend React (navigation par onglets) et sont intégrés : le lecteur 1A peut charger le flux chiffré 2A en un clic, créant un flux de travail d'annotation sécurisé de bout en bout. L'ensemble du stack démarre avec une seule commande.

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

### Pourquoi cette architecture

**Canvas API plutôt qu'une bibliothèque tierce** : l'API Canvas HTML5 donne un contrôle pixel par pixel sur le rendu sans ajouter de dépendance lourde. Dessiner trois types de formes (stylo, flèche, rectangle) ne nécessite qu'une centaine de lignes de code de rendu.

**Modèle de traits en ajout seul** : chaque trait possède un identifiant unique et est ajouté à un tableau en mémoire. Deux utilisateurs qui dessinent simultanément produisent deux traits indépendants — il n'y a pas d'état mutable partagé, donc pas de conflit à résoudre. L'annulation supprime un trait par identifiant via un message `removeStroke` ; le serveur le filtre et diffuse la suppression à tous les clients.

**Annotations temporelles** : chaque trait porte optionnellement un champ `videoTime`. Le canvas calcule une opacité par trait selon la distance temporelle — pleine opacité à moins d'une seconde du timestamp, fondu jusqu'à zéro à trois secondes. Le rendu tourne en boucle `requestAnimationFrame` pour que le fondu soit fluide sans déclencher de re-rendus React à chaque frame.

**WebSocket pour la synchronisation** : le polling HTTP introduirait de la latence et du gaspillage de bande passante. Une connexion WebSocket persistante diffuse chaque trait dès qu'il est validé (relâchement du bouton souris), assurant une synchronisation en temps réel avec un minimum de surcharge.

**Resynchronisation à la reconnexion** : quand un client se reconnecte après une coupure, il envoie immédiatement un message `join`. Le serveur répond avec un message `sync` contenant l'état complet de la session (tous les traits et commentaires). Le client re-rend depuis ce snapshot. Aucune donnée n'est perdue.

**Identifiant de session dans l'URL** : l'identifiant de session est stocké dans l'URL via `?session=xxx` (`window.history.pushState`). Ouvrir un lien partagé rejoint automatiquement la session au chargement. Aucun routage côté serveur n'est nécessaire — l'identifiant est lu dans `URLSearchParams` dans le composant React avant l'ouverture de la connexion WebSocket.

**Intégration 1A/2A** : le lecteur 1A inclut un bouton "Load Secured Stream (2A)". Il envoie une requête `POST /token` au serveur de clés avec les identifiants de démonstration, reçoit un JWT, puis initialise hls.js avec `xhrSetup` pour injecter `Authorization: Bearer <token>` sur chaque requête de clé — exactement le même mécanisme que dans le lecteur 2A autonome. La couche Canvas reste pleinement fonctionnelle sur le flux vidéo déchiffré.

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

### Vue d'ensemble du stack complet

```
  docker-compose up --build
  │
  ├── frontend        (port 4000)   React + Vite → Nginx statique
  │     ├── /         → Onglet Module 1A
  │     └── /         → Onglet Module 2A (basculé)
  │
  ├── realtime-server (port 8080)   Serveur WebSocket Node.js
  │
  ├── key-server      (port 8000)   Émetteur de tokens + porte de clé AES FastAPI
  │
  └── video-server    (port 8082)   Nginx servant le HLS chiffré
        └── /hls/stream.m3u8
        └── /hls/segment*.ts
```

---

## La décision sans base de données

C'est un choix de conception intentionnel, pas un raccourci.

**Module 1A — sessions éphémères** : une session de revue collaborative est un événement en direct, pas un enregistrement. L'artefact significatif est le snapshot JSON exporté (annotations + commentaires), que l'utilisateur télécharge explicitement. Stocker les traits dans une base de données ajouterait de la conception de schéma, des migrations, une couche de requêtes et du connection pooling — aucun de ces éléments ne change l'expérience utilisateur. Le modèle en mémoire est à la fois plus simple et correct pour ce cas d'usage.

**Module 2A — tokens sans état** : les JWT sont auto-contenus. Le serveur de clés n'a rien à rechercher : le token porte sa propre expiration (`exp`), son sujet (`sub`) et son heure d'émission (`iat`), tous protégés par la signature HMAC-SHA256. Une recherche en base par requête de clé ajouterait de la latence et un point de défaillance unique sans bénéfice. C'est exactement le cas d'usage pour lequel les JWT ont été conçus.

**Ce qui changerait cette décision** : si les sessions devaient survivre aux redémarrages du serveur, ou si le projet nécessitait la révocation de tokens avant expiration, une couche de persistance serait justifiée. Ni l'une ni l'autre de ces exigences n'existe ici.

---

## Stack technique

| Composant | Technologie | Raison |
|-----------|-------------|--------|
| Frontend | React + Vite | Accès à l'API Canvas, intégration hls.js, builds Docker rapides |
| Serveur WebSocket | Node.js + `ws` | Empreinte minimale ; le protocole est assez simple pour ne pas nécessiter Socket.io |
| Serveur de clés | FastAPI + `python-jose` | python-jose est éprouvé pour JWT ; FastAPI offre la gestion async et la doc OpenAPI gratuitement |
| Serveur vidéo | Nginx | Serveur de fichiers HLS statiques standard ; les en-têtes CORS se configurent en deux lignes |
| Chiffrement HLS | ffmpeg AES-128 (`hls_key_info_file`) | Standard industriel ; entièrement scriptable ; reproductible dans un Dockerfile |
| Conteneurisation | Docker Compose | Démarrage en une commande ; aucun compte externe ; identique sur toute machine |
| Styles | CSS Modules | Coût d'exécution nul ; noms de classes scopés ; aucune abstraction au build |
