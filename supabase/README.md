# Spellbound — Supabase setup

## Project

- **Project name:** Spellbound  
- **Database password:** spellbound-andyshen356  
- Store the password securely; it is the database password for the Supabase project (e.g. for direct DB connections), not the dashboard login.

---

## What to do

### 1. Open the SQL Editor

1. Go to [Supabase Dashboard](https://supabase.com/dashboard).
2. Open your **Spellbound** project.
3. In the left sidebar, click **SQL Editor**.

### 2. Run the migrations

**First (tables, RLS, seed):** New query, then copy all of `supabase/migrations/001_initial_schema.sql`, paste, Run.

**Second (matchmaking):** New query, then copy all of `supabase/migrations/002_try_match.sql`, paste, Run.

**Third (game sync and leave):** New query, then copy all of `supabase/migrations/003_game_sync_and_leave.sql`, paste, Run. This adds `game_players.left_at`, sets `games.started_at` when a match is created (so both players share the same timer), and enables Realtime for `game_players` so opponent score and “opponent left” updates are pushed.

**Fourth (fix 500):** New query, copy all of `supabase/migrations/004_get_game_rpc.sql`, paste, Run. Adds RPC `get_game_for_player` so the game page loads without 500.

**Fifth (fix game_players 500):** New query, copy all of `supabase/migrations/005_game_players_rls_fix.sql`, paste, Run. Replaces self-referential RLS on `game_players` with a helper so SELECT/UPDATE no longer 500.

**Sixth (challenge accept + Realtime):** New query, copy all of `supabase/migrations/006_challenge_accept_realtime.sql`, paste, Run. Adds `get_my_pending_challenges`, `accept_challenge` RPCs and enables Realtime for `challenges` so recipients get notified and can Join/Reject.

**Seventh (Bitter End choice):** New query, copy all of `supabase/migrations/007_bitter_end_choice.sql`, paste, Run. Adds `game_players.bitter_end_choice` so both players must agree on Cooperative or Competitive to continue after Round 1.

**Eighth (one-click Continue; opponent left notify):** New query, copy all of `supabase/migrations/008_bitter_end_start_and_leave_notify.sql`, paste, Run. Adds `games.bitter_end_mode`, RPC `start_bitter_end`, and updates `get_game_for_player` to return `bitter_end_mode` so one player clicking Continue advances both; the other player sees “Opponent went back to lobby” when the opponent leaves from the round-end screen.

**Ninth (game finished + puzzles from Supabase):** New query, copy all of `supabase/migrations/009_game_finished_and_puzzles.sql`, paste, Run. Adds RPC `set_game_finished` to set `games.status` and `ended_at` when Round 1 ends; updates `try_match` and `accept_challenge` to pick a random puzzle from `puzzles`; inserts two more puzzles (200+ points) so games use variety from Supabase.

**Tenth (local puzzle set):** New query, copy all of `supabase/migrations/010_local_puzzle_index.sql`, paste, Run. Adds `games.puzzle_index` and makes `puzzle_id` nullable. `try_match` and `accept_challenge` now pick a random index 0..14 instead of a DB puzzle; `get_game_for_player` returns `puzzle_index` when set. The client loads `data/puzzles.json` (15 puzzles) and uses that for boards instead of the database puzzle set.

Tables, triggers, RLS, seed puzzles, `try_match`, Realtime for `game_players` and `challenges`, `get_game_for_player`, challenge RPCs, Bitter End choice, one-click Continue, game finished, and local puzzle index are in place.

### 3. Confirm in the Table Editor

In the left sidebar, open **Table Editor**. You should see: “Success. No rows returned”:

- `users`
- `puzzles` (with seed rows from 001 and 009)
- `games`
- `game_players`
- `challenges`
- `matchmaking_queue`

### 4. (Optional) Enable Auth and test signup

1. Go to **Authentication** → **Providers** and ensure **Email** (and any others you need) are enabled.
2. In your app, use the Supabase JS client to sign up/sign in; the trigger will create a row in `public.users` from `auth.users`.

---

## Row Level Security (RLS)

RLS is **enabled** on all tables. Summary:

| Table              | Who can do what |
|--------------------|------------------|
| **users**          | Authenticated: read all (for search). Insert/update own row only. |
| **puzzles**       | Authenticated: read all. No insert/update/delete from client (use Dashboard or service role to add puzzles). |
| **games**          | Authenticated: create. Read/update only games they are in (via `game_players`). |
| **game_players**  | Read/update only rows for games you’re in; insert/update only your own row. |
| **challenges**     | Read/insert/update only challenges you sent or received. |
| **matchmaking_queue** | Read all (to match). Insert/update/delete only your own row. |

To add or change puzzles from the client, you’d add a policy (e.g. `puzzles_insert_authenticated`) or use a Supabase Edge Function / backend with the service role key.

---

## Running migrations again

The migration is not idempotent: running it a second time will create duplicate objects and fail. Run it **once** per project. To reset, drop tables in reverse order (or use **Database** → **Migrations** in the dashboard if you use Supabase CLI migrations).
