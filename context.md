# Quest 404 — Project Context & Documentation

Quest 404 is a real-time, PWA-ready **Campus Scavenger Hunt & Cybersecurity Scavenger Interface**. It is designed as a lightweight, performant, mobile-first web application where players locate physical checkpoint nodes, scan QR codes to unlock domain-specific challenges (Cybersecurity and Mathematics), submit decryptions, and track scores on a live leaderboard.

---

## 1. Tech Stack Overview

- **Core Frontend**: Semantic HTML5, Vanilla CSS (Custom Design System with a Sci-Fi White & Muted Cyan theme), and ES Modules JavaScript.
- **Backend & Database**: **Supabase (PostgreSQL)** serving as the database, authentication layer, and real-time subscription engine.
- **Database Operations**: Business logic is secured via PostgreSQL Row Level Security (RLS) and executed securely through database **RPC functions (Security Definer)**.
- **External Libraries (via CDN)**:
  - `@supabase/supabase-js@2` — Supabase Client SDK
  - `html5-qrcode` — Browser-based QR code camera scanner
  - `qrcodejs` — Dynamic QR code generator (for Admin player-link generation)
  - `canvas-confetti` — Visual celebrations upon team victory/game completions
- **Deployment**: Configured for continuous deployment via **Netlify** (`netlify.toml`).

---

## 2. File & Directory Map

```filepath
Quest-404-/
├── .env.example              # Template for Supabase credentials URL & anon keys
├── index.html                # Landing entrypoint (Player Self-Registration & Spectator entry)
├── play.html                 # Active game panel for players (Scanner, hints, quiz portal)
├── admin.html                # Admin Control Panel for session directors (Auth-guarded)
├── leaderboard.html          # Spectator Live Standings & podium board
├── sw.js                     # PWA Service Worker for offline asset caching
├── manifest.json             # PWA app metadata and launch configuration
├── netlify.toml              # Netlify redirection & headers layout
├── inject-env.js             # Deployment utility to inject environment variables
├── assets/                   # Static media, icons, and logo assets
├── css/
│   ├── design-system.css     # Core variables, fonts (Orbitron, Inter, JetBrains Mono) & utilities
│   ├── components.css        # Shared custom components (buttons, input fields, cards, tables)
│   ├── admin.css             # Sidebar menu and split view layout rules for the Control Console
│   ├── player.css            # Gameplay styling (hints, cameras, lists, loader overlays)
│   └── leaderboard.css       # Ranks tables and animated podium styling
├── js/
│   ├── config.js             # Supabase Client setup & global window exports
│   ├── utils.js              # Helpers (toast, sanitizer, clipboard, token generator, formatters)
│   ├── auth.js               # Admin authentication handler (GetUser, SignIn, SignOut, guards)
│   ├── admin/                # Admin sub-modules
│   │   ├── admin.js          # Core coordinator & tab manager
│   │   ├── dashboard.js      # Live telemetry tracker
│   │   ├── sessions.js       # Game sessions creator & state controller
│   │   ├── teams.js          # Team creator & session linkers
│   │   ├── players.js        # Player linker & unassigned auto-distributor (round-robin)
│   │   ├── checkpoints.js    # Scavenger checkpoint nodes manager
│   │   ├── questions.js      # Questions repository manager
│   │   └── routes.js         # Route generator & path matrix planner
│   ├── player/               # Player sub-modules
│   │   ├── game.js           # Core state coordinator (Timer sync, state machine, sub-channels)
│   │   ├── scanner.js        # QR Reader camera initialization & correct identifier validation
│   │   └── questions.js      # Quiz form renderer & input validation tracker
│   └── leaderboard/          # Leaderboard sub-modules
│       └── live.js           # Spectator standings updates & live scoreboard channel listener
└── sql/
    ├── schema.sql            # Primary database tables, view aggregations, RPCs, and RLS policies
    └── migration_self_reg.sql# Migration for player self-registration & nullable team assignment
```

---

## 3. Database Schema Details

The application uses **Supabase Row Level Security (RLS)** to guard table access. Players access data primarily through custom views and RPCs, ensuring correct answers remain secure.

### Tables

1. **`sessions`**: Tracks hunt instances.
   - `id` (UUID, Primary Key)
   - `title` (Text)
   - `duration` (Integer, minutes)
   - `status` (`'draft'`, `'active'`, `'completed'`)
   - `route_mode` (`'random'`, `'manual'`)
   - `questions_per_checkpoint` (Integer, default 2)
   - `started_at` (Timestamp with time zone)
2. **`teams`**: Groups of players associated with a session.
   - `id` (UUID, Primary Key)
   - `session_id` (References `sessions.id`)
   - `team_name` (Text)
   - *Unique Constraint*: `(session_id, team_name)`
3. **`checkpoints`**: Physical scavenger locations.
   - `id` (UUID, Primary Key)
   - `session_id` (References `sessions.id`)
   - `checkpoint_name` (Text)
   - `hint` (Text, clues shown to player)
   - `qr_identifier` (Text, scanned values, e.g., UUID/Hash)
4. **`players`**: Individual participants.
   - `id` (UUID, Primary Key)
   - `session_id` (References `sessions.id`)
   - `team_id` (References `teams.id`, Nullable for pending self-registration)
   - `player_name` (Text)
   - `access_token` (Text, Unique token to sign in, e.g., `PL-XXXX-XXXX`)
   - `current_checkpoint` (References `checkpoints.id`)
   - *Unique Constraints*:
     - `(session_id, lower(player_name))` to prevent duplicate names per session.
     - `(team_id, lower(player_name))` (when team assigned) to prevent duplicate names per team.
5. **`questions`**: Full list of challenges (Admin only).
   - `id` (UUID, Primary Key)
   - `topic` (`'cybersecurity'`, `'mathematics'`)
   - `difficulty` (`'easy'`, `'medium'`, `'hard'`)
   - `question_type` (`'mcq'`, `'text'`)
   - `question` (Text)
   - `options` (JSONB, array of option strings)
   - `answer` (Text, correct option index or direct string)
   - `is_active` (Boolean)
6. **`player_routes`**: Path checklist mapping order of checkpoints for each player.
   - `id` (UUID, Primary Key)
   - `player_id` (References `players.id`)
   - `checkpoint_id` (References `checkpoints.id`)
   - `route_order` (Integer)
   - `is_completed` (Boolean)
   - `completed_at` (Timestamp)
7. **`player_answers`**: Submission history for grading.
   - `id` (UUID, Primary Key)
   - `player_id` (References `players.id`)
   - `checkpoint_id` (References `checkpoints.id`)
   - `question_id` (References `questions.id`)
   - `submitted_answer` (Text)
   - `is_correct` (Boolean)
8. **`player_checkpoint_questions`**: Questions pre-allocated to players at checkpoints.
   - `player_id` (References `players.id`)
   - `checkpoint_id` (References `checkpoints.id`)
   - `question_id` (References `questions.id`)
9. **`checkpoint_questions`**: Shared questions allocated to checkpoints per session (seeded by the first player to arrive at each checkpoint).
   - `id` (UUID, Primary Key)
   - `session_id` (References `sessions.id`)
   - `checkpoint_id` (References `checkpoints.id`)
   - `question_id` (References `questions.id`)
   - *Unique Constraint*: `(session_id, checkpoint_id, question_id)`

### Views

- **`questions_public`**: Safe subset of questions for players (excludes the `answer` column).
- **`leaderboard_view`**: Live calculations aggregating player scoring metrics to compute team standings.
  - Sorts standings: Highest total score first, then shortest elapsed seconds since the session started (`started_at`).

### Secure RPC Functions

- **`get_or_create_player_state(p_token text)`** (Security Definer):
  - Fetches the active player and session details.
  - If a team is assigned and questions haven't been generated for the player's active checkpoint:
    - It checks if shared questions exist in `checkpoint_questions` for this session and checkpoint.
    - If not, it randomly selects and inserts active questions into `checkpoint_questions` (seeding them for everyone).
    - It then replicates these shared questions into `player_checkpoint_questions` for this player so they can be securely loaded.
- **`submit_checkpoint_answers(p_token text, p_checkpoint_id uuid, p_answers jsonb)`** (Security Definer):
  - Authenticates the submission using the access token.
  - Verifies session status, time limit, and checks if the checkpoint matches the player's active state.
  - Grades answers case-insensitively, updates `player_answers`, marks the checkpoint route as completed, and shifts the player's current checkpoint to the next sequential one.

---

## 4. Key Workflows

### A. Player Self-Registration
- Player registers with Session ID & Player Name.
- App returns a unique Access Token (`PL-XXXX-XXXX`).
- Player is loaded into the standby waiting room until they are assigned to a team (Manual or auto-distributed via round-robin distribution) and the session is started.
- Realtime subscriptions trigger the state transition once active.

### B. Node Scanning & Decryption
- Player views their active checkpoint hint coordinates.
- Player clicks "Scan Node" to initialize the browser camera scanner.
- If the scanned QR code matches the active checkpoint identifier, the assigned challenges are fetched from `questions_public`.
- The questions are shared and uniform for all players visiting this checkpoint: the first player to scan a checkpoint seeds the active questions, and all subsequent players who scan that same checkpoint are served the exact same questions.
- The player submits their decryptions, which are verified securely via the database.

### C. Live Telemetry & Spectator Leaderboard
- The spectator leaderboard listens in real-time to the database changes (`player_answers` submissions).
- Standard rankings updates occur instantly.
- When an admin terminates or completes a session, it triggers a live celebratory banner across spectator dashboards.

---

## 5. UI & Design System Tokens

The application features a sleek, high-fidelity light Sci-Fi look.
- **Typography**:
  - `Orbitron`: Headlines and badge markings.
  - `Inter`: UI readability, buttons, and system logs.
  - `JetBrains Mono`: Token strings, timers, indices, and input logs.
- **Theme Variables**:
  - Background slate: `#f8fafc` (`--bg-color`)
  - Accent / Primary Cyan: `#22a7c4` (`--color-primary`)
  - Secondary Teal: `#1a7a9e` (`--color-secondary`)
  - Warning Red / Accent: `#dc4a4a` (`--color-accent`)
  - Alert Amber: `#d9930b` (`--color-warning`)

---

## 6. Offline & PWA Setup

- **`manifest.json`**: Specifies standalone display mode, orientation parameters, and icon arrays.
- **`sw.js`**: Caches layout pages and dependency styling locally, providing network fallback support to handle intermittent connectivity during campus events.
