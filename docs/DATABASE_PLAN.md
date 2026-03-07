# Spellbound — Database Plan

This document describes proposed tables and relationships for a real backend. Use it to decide how to proceed (e.g. which DB, when to implement).

## Supabase (implemented)

- **Project name:** Spellbound  
- **Database password:** spellbound-andyshen356  

All schema, triggers, RLS policies, and a seed puzzle are in **`supabase/migrations/001_initial_schema.sql`**. Run that file once in the Supabase SQL Editor. See **`supabase/README.md`** for step-by-step instructions.

---

## Overview

- **Users** sign up, log in, and have profile/settings.
- **Games** are rounds with a fixed puzzle (center + 6 letters), timer, and valid word list.
- **Challenges** are one user inviting another; when accepted, a game is created.
- **Matchmaking** pairs two users who both clicked “Match me” into a new game.
- **Scores and words** are stored per player per game.

---

## Tables

### 1. `users`

| Column         | Type         | Notes                          |
|----------------|--------------|--------------------------------|
| `id`           | UUID / bigint | Primary key                    |
| `username`     | VARCHAR(64)  | Unique, not null               |
| `password_hash`| VARCHAR(255) | Not null                       |
| `email`        | VARCHAR(255) | Optional, for recovery         |
| `created_at`   | TIMESTAMP    | Default now()                  |
| `updated_at`   | TIMESTAMP    | Default now(), updated on change |

- Index: `UNIQUE(username)`.
- Optional: `display_name`, `avatar_url`.

---

### 2. `puzzles`

Pre-generated letter sets and their word lists (so many games can reuse the same puzzle).

| Column           | Type         | Notes                          |
|------------------|--------------|--------------------------------|
| `id`             | UUID / bigint | Primary key                    |
| `center_letter`   | CHAR(1)      | Not null                       |
| `outer_letters`  | VARCHAR(6)   | Or JSON: `["R","T","A","L","N","P"]` |
| `valid_words`    | JSON / JSONB | Array of valid words (4+ letters) |
| `pangrams`       | JSON / JSONB | Optional: words that use all 7  |
| `total_points`   | INT          | Optional: max possible score    |
| `created_at`     | TIMESTAMP    |                                |

- Index on `(center_letter, outer_letters)` if you look up by letter set.
- `valid_words` could instead be a separate `puzzle_words` table (puzzle_id, word, is_pangram) for easier querying.

---

### 3. `games`

One row per round (solo or versus).

| Column          | Type         | Notes                          |
|-----------------|--------------|--------------------------------|
| `id`            | UUID / bigint | Primary key                    |
| `puzzle_id`     | FK → puzzles | Not null                       |
| `duration_seconds` | INT        | e.g. 600 for 10 min            |
| `status`        | VARCHAR(20)  | `waiting` \| `in_progress` \| `finished` \| `abandoned` |
| `created_at`     | TIMESTAMP    |                                |
| `started_at`    | TIMESTAMP    | When timer actually started    |
| `ended_at`      | TIMESTAMP    | When time ran out or all words found |

- Index: `status`, `created_at` (for listing recent games).

---

### 4. `game_players`

Links users to games and stores their result.

| Column       | Type         | Notes                          |
|--------------|--------------|--------------------------------|
| `id`         | UUID / bigint | Primary key                    |
| `game_id`    | FK → games   | Not null                       |
| `user_id`    | FK → users   | Nullable for “anonymous” solo   |
| `score`      | INT          | Default 0                      |
| `words_found`| JSON / JSONB | Array of words they submitted  |
| `role`       | VARCHAR(20)  | e.g. `player` \| `opponent` (for display order) |
| `joined_at`  | TIMESTAMP    |                                |

- Unique: `(game_id, user_id)` if user_id is not null; otherwise one row per game for solo.
- Index: `user_id` (for “my games”), `game_id`.

---

### 5. `challenges`

Direct invites (Challenge a friend).

| Column        | Type         | Notes                          |
|---------------|--------------|--------------------------------|
| `id`          | UUID / bigint | Primary key                    |
| `from_user_id`| FK → users   | Not null                       |
| `to_user_id`   | FK → users   | Not null                       |
| `status`      | VARCHAR(20)  | `pending` \| `accepted` \| `declined` \| `expired` |
| `game_id`     | FK → games   | Set when accepted (game created) |
| `created_at`  | TIMESTAMP    |                                |
| `responded_at`| TIMESTAMP    | When accepted/declined          |

- Index: `to_user_id`, `status` (for “my pending invites”).
- Index: `from_user_id` (for “my sent challenges”).

---

### 6. `matchmaking_queue` (optional)

For “Match me”: users waiting to be paired.

| Column          | Type         | Notes                          |
|-----------------|--------------|--------------------------------|
| `id`            | UUID / bigint | Primary key                    |
| `user_id`       | FK → users   | Unique: one row per user in queue |
| `joined_at`     | TIMESTAMP    |                                |
| `matched_game_id` | FK → games | Set when paired; then remove row |

- When two users are in the queue, create a `game`, add two `game_players`, set `matched_game_id` for both (or just delete rows), remove both from queue.
- Alternative: no table; use Redis or in-memory queue that creates a game and writes to `games` + `game_players` when two users match.

---

## Relationships (summary)

- **users** — one-to-many **game_players**; one-to-many **challenges** (as from_user and to_user).
- **puzzles** — one-to-many **games**.
- **games** — one-to-many **game_players**; one-to-one **challenges** (when game created from challenge).
- **challenges** — many-to-one **users** (from, to); many-to-one **games** (when accepted).

---

## Auth / sessions

- No `sessions` table in this plan: assume **JWT** or **session cookie** with signed payload (user id, expiry). Server validates and loads user.
- If you prefer DB-backed sessions: add a `sessions` table (id, user_id, token_hash, expires_at).

---

## Optional extensions

- **Friend list**: `user_friends` (user_id, friend_id, created_at).
- **Leaderboards**: Materialized view or cache from `game_players` (e.g. total score per user, or best score per puzzle).
- **Puzzle of the day**: `puzzles` row selected by date; `games` can reference it.

---

## Next steps (your choice)

1. **Adopt as-is** — Use this plan when you add a backend (Node + Postgres, etc.).
2. **Simplify** — e.g. drop `puzzles`, store center + outer letters + valid_words directly on `games` for MVP.
3. **Change types** — e.g. use UUIDs everywhere, or bigint; store words in a normalised `game_words` table instead of JSON.
4. **Add/remove tables** — e.g. add `user_settings`, or merge matchmaking into a generic “lobby” table.

Once you decide, we can refine the plan or generate migrations.
