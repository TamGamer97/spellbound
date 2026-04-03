# Spellbound

Spelling Bee–style word game with **solo** and **versus** modes, built on Supabase and a custom puzzle generator.

## Overview

- **Front end**: three static pages (`index.html`, `lobby.html`, `game.html`) with vanilla JS in `js/` and styles in `css/`.
- **Game data**: precomputed puzzle set in `data/puzzles-2.json`, plus word lists and review files.
- **Backend**: Supabase (auth, users, games, matchmaking) + optional Netlify Functions (e.g. on‑the‑fly puzzle generation).

## Bot mode

In addition to **solo** and **versus**, the lobby includes **“Challenge a bot”** with 3 difficulty levels:
- `Wordsmith` (fastest bot)
- `Literate`
- `Covfefe` (slowest bot)

How it works:
- The lobby starts the bot by redirecting to `game.html` with:
  - `bot=1` (mode flag)
  - `botLevel=1|2|3` (difficulty)
- Bot games use a local opponent (no Supabase matchmaking).
- The bot finds words automatically on a timer and the opponent card shows the bot name and score.
- Puzzle selection uses the same logic as **solo** (recent-board avoidance, rarity-weighted pick among eligible boards, same Netlify fallback when local boards are exhausted).

## How puzzles are generated

- The main generator lives in `scripts/v2/index.js` (see `scripts/v2/README.md` for full details).
- Source words come from `data/wiki-100k.txt` (common English words) and a curated list of common 7‑letter words.
- Each puzzle:
  - Uses **exactly 7 unique letters**: 1 center + 6 outer.
  - Requires every word to:
    - Be at least 4 letters,
    - Include the center letter,
    - Use only those 7 letters.
  - Must have **at least 2 pangrams** (words that use all 7 letters).
- Output puzzles are cleaned and enriched by v2 maintenance scripts:
  - Remove bad/foreign pangrams and proper nouns using a shared blocklist and `data/bad-pangrams.txt`.
  - Rebuild `valid_words` and `total_points` from the full word list.
  - Optionally strip nonsense / fragment words via `data/invalid-valid-words.txt`.

For the full generation and cleanup pipeline, see `scripts/README.md` and `scripts/v2/README.md`.

### Runtime fallback generation

- When every local board in `data/puzzles-2.json` has been used, the client can call a Netlify Function (`/.netlify/functions/generate-puzzle`).
- That function imports `generateSinglePuzzle` from `scripts/v2/index.js` and returns a fresh puzzle shaped like the existing ones, so solo games never “run out” of boards.

## Database & backend structure (high level)

- **Supabase** (see `supabase/README.md` and `docs/DATABASE_PLAN.md`):
  - RPCs and triggers handle matchmaking, starting games, syncing scores, and marking games finished.
  - RLS policies restrict each player to only see/update their own games and challenges.

**Core tables**

| Table                 | Purpose                                                                   |
|-----------------------|---------------------------------------------------------------------------|
| `users`               | App users (linked to Supabase Auth).                                     |
| `puzzles`             | Optional DB puzzle rows (historical; most boards are local JSON).        |
| `games`               | Game sessions (mode, status, puzzle index, timestamps).                  |
| `game_players`        | Per‑player score, words found, left_at, bitter‑end choices.              |
| `challenges`          | Direct challenges between users (pending/accepted/rejected).             |
| `matchmaking_queue`   | Queue rows for “find me a match” style pairing.                          |

**RLS summary**

| Table                 | Who can do what                                                                 |
|-----------------------|----------------------------------------------------------------------------------|
| `users`               | Authenticated: read all (for search). Insert/update own row only.              |
| `puzzles`             | Authenticated: read all. No insert/update/delete from client (use service role).|
| `games`               | Authenticated: create. Read/update only games they are in (via `game_players`). |
| `game_players`        | Read/update only rows for games you’re in; insert/update only your own row.     |
| `challenges`          | Read/insert/update only challenges you sent or received.                        |
| `matchmaking_queue`   | Read all (for matching). Insert/update/delete only your own row.                |

**Local puzzles vs DB puzzles**

- The live game uses `data/puzzles-2.json` and a `puzzle_index` stored in the `games` table.
- Older migrations that referenced `puzzles.json` are kept for history; the canonical set is `puzzles-2.json`.

More detail (schemas, migrations, and RLS policy descriptions) lives in `supabase/README.md` and `docs/DATABASE_PLAN.md`.

## Project structure & folder hierarchy

```text
Spellbound/
├── index.html          # Auth (login / signup)
├── lobby.html          # Mode selection, matchmaking, settings
├── game.html           # Main game board (solo + versus)
├── js/
│   ├── game.js         # Core game logic, timer, scoring, honeycomb UI
│   ├── lobby.js        # Lobby UI, matchmaking, settings modal
│   ├── db.js           # Supabase client + RPC helpers
│   ├── recent-boards.js# Client-side tracking of recently played boards
│   └── proper-noun-blocklist.js # Shared blocklist used by scripts and game
├── css/
│   ├── common.css      # Base styles, typography, layout
│   ├── pages.css       # Auth + lobby pages
│   └── game.css        # Game board, honeycomb, mobile layout
├── data/
│   ├── puzzles-2.json  # Canonical puzzle set used by the game
│   ├── wiki-100k.txt   # Main word list for generation / enrichment
│   ├── common-7-letter-words.txt # Extra pangram candidates
│   ├── pangram-review.txt        # Manual review of pangrams (✓ / ✗)
│   ├── bad-pangrams.txt          # Pangrams to exclude
│   ├── invalid-valid-words.txt   # Fragment / nonsense words to strip
│   └── archive/        # Legacy / experimental puzzle sets
├── scripts/            # Generators, maintenance, analysis (see below)
├── supabase/           # SQL migrations + setup README
├── docs/               # Design notes, DB plan, archival docs
└── netlify/
    └── functions/      # Serverless helpers (e.g. generate-puzzle)
```

## Scripts layout (quick map)

- `scripts/v1/` — original Node generator (legacy).
- `scripts/v2/` — main generator and v2 maintenance tools:
  - `index.js` — generates `data/puzzles-2.json`.
  - `letter-stats-2.js` — letter frequency analysis.
  - `cleanup-puzzles-2-pangrams.js`, `enrich-puzzles-2.js`, `remove-invalid-valid-words.js`, `extract-bad-pangrams.js`, `find-invalid-words.js`, `test-board-selection.js` — maintenance helpers for `puzzles-2.json` (see `scripts/README.md` for commands).
- `scripts/v3/` — experimental Python generator (results in `data/archive/`).

### Puzzle generation (by folder)

| Folder | Purpose                                  | Output                                     |
|--------|------------------------------------------|--------------------------------------------|
| `v1`   | Original word‑list puzzle generator.     | `data/puzzles.json` (legacy).              |
| `v2`   | **Main generator** — wiki‑100k + common‑7, blocklist filtering. | `data/puzzles-2.json` (canonical). |
| `v3`   | Python generator (SCOWL/ENABLE).         | `data/archive/puzzles-v3-experimental.json`|

### Maintenance & analysis scripts (v2)

| Script (v2)                      | Purpose                                                                              |
|----------------------------------|--------------------------------------------------------------------------------------|
| `v2/cleanup-puzzles-2-pangrams.js`        | Remove bad pangrams from `data/puzzles-2.json` and drop puzzles with no pangram left. |
| `v2/enrich-puzzles-2.js`                 | Recompute `valid_words` and `total_points` for every puzzle.                        |
| `v2/remove-invalid-valid-words.js`       | Remove fragment / nonsense words from `valid_words` / `pangrams`.                   |
| `v2/extract-bad-pangrams.js`             | Extract ✗ pangrams from `pangram-review.txt` into `data/bad-pangrams.txt`.          |
| `v2/find-invalid-words.js`               | List `valid_words` not present in `wiki-100k.txt` for manual review.               |
| `v2/test-board-selection.js`             | Exercise the random board selection logic over `puzzles-2.json`.                   |
| `v2/letter-stats-2.js`                   | Letter frequency stats across all puzzles in `data/puzzles-2.json`.                 |

## Docs quick links

| File / folder        | Description                                       |
|----------------------|---------------------------------------------------|
| `docs/DATABASE_PLAN.md` | Database schema and migration notes (Supabase).   |
| `docs/archive/`         | Old notes and experiments.                        |

More background docs live in `docs/README.md` and the files it links to.
