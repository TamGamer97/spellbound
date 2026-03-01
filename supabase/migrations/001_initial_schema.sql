-- =============================================================================
-- Spellbound — Initial schema for Supabase
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- =============================================================================

-- Extensions (Supabase usually has these; harmless if already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. USERS (public profile; auth is in auth.users, no password here)
-- =============================================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(64) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_key UNIQUE (username)
);

CREATE INDEX idx_users_username ON public.users (username);
CREATE INDEX idx_users_username_lower ON public.users (lower(username));

COMMENT ON TABLE public.users IS 'Profile data; auth handled by Supabase Auth (auth.users).';

-- =============================================================================
-- 2. PUZZLES
-- =============================================================================
CREATE TABLE public.puzzles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  center_letter CHAR(1) NOT NULL,
  outer_letters VARCHAR(6) NOT NULL,
  valid_words JSONB NOT NULL DEFAULT '[]'::jsonb,
  pangrams JSONB DEFAULT '[]'::jsonb,
  total_points INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_puzzles_letters ON public.puzzles (center_letter, outer_letters);

COMMENT ON TABLE public.puzzles IS 'Pre-generated letter sets and word lists for games.';

-- =============================================================================
-- 3. GAMES
-- =============================================================================
CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  puzzle_id UUID NOT NULL REFERENCES public.puzzles(id) ON DELETE RESTRICT,
  duration_seconds INT NOT NULL DEFAULT 600,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'in_progress', 'finished', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_games_status ON public.games (status);
CREATE INDEX idx_games_created_at ON public.games (created_at DESC);

COMMENT ON TABLE public.games IS 'One row per round (solo or versus).';

-- =============================================================================
-- 4. GAME_PLAYERS
-- =============================================================================
CREATE TABLE public.game_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  score INT NOT NULL DEFAULT 0,
  words_found JSONB NOT NULL DEFAULT '[]'::jsonb,
  role VARCHAR(20) NOT NULL DEFAULT 'player'
    CHECK (role IN ('player', 'opponent')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_players_game_user_unique UNIQUE (game_id, user_id)
);

CREATE INDEX idx_game_players_user_id ON public.game_players (user_id);
CREATE INDEX idx_game_players_game_id ON public.game_players (game_id);

COMMENT ON TABLE public.game_players IS 'Links users to games; stores score and words found.';

-- =============================================================================
-- 5. CHALLENGES
-- =============================================================================
CREATE TABLE public.challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT challenges_from_ne_to CHECK (from_user_id != to_user_id)
);

CREATE INDEX idx_challenges_to_status ON public.challenges (to_user_id, status);
CREATE INDEX idx_challenges_from ON public.challenges (from_user_id);

COMMENT ON TABLE public.challenges IS 'Direct invites (Challenge a friend).';

-- =============================================================================
-- 6. MATCHMAKING_QUEUE
-- =============================================================================
CREATE TABLE public.matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  CONSTRAINT matchmaking_queue_user_key UNIQUE (user_id)
);

CREATE INDEX idx_matchmaking_queue_joined ON public.matchmaking_queue (joined_at);

COMMENT ON TABLE public.matchmaking_queue IS 'Users waiting to be paired for Match me.';

-- =============================================================================
-- TRIGGER: Create public.users row when auth.users row is created
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1), 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================================
-- updated_at trigger helper
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- --- users ---
-- Anyone authenticated can read users (for search by username)
CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT TO authenticated USING (true);

-- Users can insert their own row (trigger does this with SECURITY DEFINER; this allows app to upsert profile)
CREATE POLICY "users_insert_own" ON public.users
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Users can update only their own row
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- No delete for users (cascade from auth.users handles account delete)

-- --- puzzles ---
-- Authenticated users can read all puzzles (needed to start/play games)
CREATE POLICY "puzzles_select_authenticated" ON public.puzzles
  FOR SELECT TO authenticated USING (true);

-- Only service role can insert/update/delete puzzles (admin/seed); no policy = no access for anon/authenticated
-- To allow app to insert puzzles, add:
-- CREATE POLICY "puzzles_insert_service" ON public.puzzles FOR INSERT TO service_role WITH CHECK (true);

-- --- games ---
-- Users can read games they are in (via game_players)
CREATE POLICY "games_select_own" ON public.games
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.game_players gp
      WHERE gp.game_id = games.id AND gp.user_id = auth.uid()
    )
  );

-- Authenticated users can create games (solo or when creating from challenge/match)
CREATE POLICY "games_insert_authenticated" ON public.games
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can update games they are in (e.g. status, started_at, ended_at)
CREATE POLICY "games_update_own" ON public.games
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.game_players gp
      WHERE gp.game_id = games.id AND gp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.game_players gp
      WHERE gp.game_id = games.id AND gp.user_id = auth.uid()
    )
  );

-- --- game_players ---
-- Users can read game_players for games they are in
CREATE POLICY "game_players_select_own" ON public.game_players
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.game_players gp2
      WHERE gp2.game_id = game_players.game_id AND gp2.user_id = auth.uid()
    )
  );

-- Users can insert themselves into a game (when joining)
CREATE POLICY "game_players_insert_own" ON public.game_players
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Users can update their own game_players row (score, words_found)
CREATE POLICY "game_players_update_own" ON public.game_players
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- challenges ---
-- Users can read challenges they sent or received
CREATE POLICY "challenges_select_own" ON public.challenges
  FOR SELECT TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

-- Users can create challenges (from_user_id must be self)
CREATE POLICY "challenges_insert_own" ON public.challenges
  FOR INSERT TO authenticated WITH CHECK (from_user_id = auth.uid());

-- Recipient can update (accept/decline); sender could cancel by updating status
CREATE POLICY "challenges_update_own" ON public.challenges
  FOR UPDATE TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid())
  WITH CHECK (from_user_id = auth.uid() OR to_user_id = auth.uid());

-- --- matchmaking_queue ---
-- Users can read the queue (to see who is waiting; optionally restrict to own row only)
CREATE POLICY "matchmaking_queue_select_authenticated" ON public.matchmaking_queue
  FOR SELECT TO authenticated USING (true);

-- Users can insert their own row (join queue)
CREATE POLICY "matchmaking_queue_insert_own" ON public.matchmaking_queue
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Users can update their own row (e.g. set matched_game_id when paired)
CREATE POLICY "matchmaking_queue_update_own" ON public.matchmaking_queue
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own row (leave queue)
CREATE POLICY "matchmaking_queue_delete_own" ON public.matchmaking_queue
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =============================================================================
-- SEED: One puzzle so you can create games (run once; skip if you seed elsewhere)
-- =============================================================================
INSERT INTO public.puzzles (center_letter, outer_letters, valid_words, pangrams, total_points)
VALUES (
  'E',
  'RTALNP',
  '["REAL","RATE","LATE","TEAR","NEAR","PEAR","LEAN","PEAL","LEAP","PALE","PANE","TAPE","REEL","PEER","LEER","RANT","ANTE","LANE","PEARL","LEARN","PLANE","PANEL","PLANET","REPEAT","REPEAL","REPLANT","PLANTER","PARENT","TREAT","ALTER","LATER","RENAL","APERT","PETAL","PLEAT","PLATE","REAP"]'::jsonb,
  '["REPLANT","PLANTER"]'::jsonb,
  200
);
