-- =============================================================================
-- Spellbound — try_match RPC for matchmaking
-- Run after 001_initial_schema.sql. Pairs two users from the queue and creates a game.
-- =============================================================================

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

  -- Lock and fetch two distinct users waiting in queue (oldest first)
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

  INSERT INTO public.games (puzzle_id, duration_seconds, status)
  VALUES (pid, 600, 'waiting')
  RETURNING id INTO gid;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u1_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u2_id, 'opponent');

  UPDATE public.matchmaking_queue
  SET matched_game_id = gid
  WHERE user_id IN (u1_id, u2_id);

  RETURN gid;
END;
$$;

-- Allow authenticated users to call try_match
GRANT EXECUTE ON FUNCTION public.try_match() TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_match() TO service_role;

COMMENT ON FUNCTION public.try_match() IS 'Pairs two users from matchmaking_queue, creates a game and two game_players, returns game id or null.';
