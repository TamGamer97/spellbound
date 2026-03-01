-- =============================================================================
-- Spellbound — Game sync (timer start) and leave detection
-- Run after 002_try_match.sql.
-- =============================================================================

-- Track when a player left so the opponent can be notified
ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

COMMENT ON COLUMN public.game_players.left_at IS 'Set when the player leaves; opponent is notified via Realtime.';

-- Timer: set game started_at when match is created so both players share the same clock
CREATE OR REPLACE FUNCTION public.try_match()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid UUID;
  gid UUID;
  u1_id UUID;
  u2_id UUID;
  r RECORD;
  n INT := 0;
BEGIN
  SELECT id INTO pid FROM public.puzzles ORDER BY created_at LIMIT 1;
  IF pid IS NULL THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT user_id FROM public.matchmaking_queue
    WHERE matched_game_id IS NULL
    ORDER BY joined_at
    FOR UPDATE SKIP LOCKED
    LIMIT 2
  LOOP
    IF n = 0 THEN u1_id := r.user_id; END IF;
    IF n = 1 THEN u2_id := r.user_id; END IF;
    n := n + 1;
  END LOOP;

  IF n < 2 OR u1_id IS NULL OR u2_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- started_at set so both players calculate the same remaining time
  INSERT INTO public.games (puzzle_id, duration_seconds, status, started_at)
  VALUES (pid, 600, 'in_progress', now())
  RETURNING id INTO gid;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u1_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u2_id, 'opponent');

  UPDATE public.matchmaking_queue
  SET matched_game_id = gid
  WHERE user_id IN (u1_id, u2_id);

  RETURN gid;
END;
$$;

-- Enable Realtime for game_players so opponent score and left_at updates are pushed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'game_players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
  END IF;
END $$;
