-- =============================================================================
-- Spellbound — First player's preferred puzzle indices (from last 2 boards) for variety.
-- Run after 011. Match: first in queue; Challenge: challenger (from_user_id).
-- =============================================================================

ALTER TABLE public.matchmaking_queue
  ADD COLUMN IF NOT EXISTS preferred_puzzle_indices INT[];

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS preferred_puzzle_indices INT[];

COMMENT ON COLUMN public.matchmaking_queue.preferred_puzzle_indices IS 'First player prefers these puzzle indices (low overlap with recent boards).';
COMMENT ON COLUMN public.challenges.preferred_puzzle_indices IS 'Challenger prefers these puzzle indices when game is created on accept.';

-- try_match: use first queued player's preferred_puzzle_indices when picking puzzle_index
CREATE OR REPLACE FUNCTION public.try_match()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid UUID;
  u1_id UUID;
  u2_id UUID;
  r RECORD;
  n INT := 0;
  pidx INT;
  preferred INT[];
  num_puzzles INT := 500;
BEGIN
  FOR r IN
    SELECT user_id, preferred_puzzle_indices FROM public.matchmaking_queue
    WHERE matched_game_id IS NULL
    ORDER BY joined_at
    FOR UPDATE SKIP LOCKED
    LIMIT 2
  LOOP
    IF n = 0 THEN
      u1_id := r.user_id;
      preferred := r.preferred_puzzle_indices;
    END IF;
    IF n = 1 THEN u2_id := r.user_id; END IF;
    n := n + 1;
  END LOOP;

  IF n < 2 OR u1_id IS NULL OR u2_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF preferred IS NOT NULL AND array_length(preferred, 1) > 0 THEN
    pidx := preferred[1 + floor(random() * array_length(preferred, 1))::int];
  ELSE
    pidx := floor(random() * num_puzzles)::int;
  END IF;

  INSERT INTO public.games (puzzle_id, puzzle_index, duration_seconds, status, started_at)
  VALUES (NULL, pidx, 300, 'in_progress', now())
  RETURNING id INTO gid;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u1_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u2_id, 'opponent');

  UPDATE public.matchmaking_queue
  SET matched_game_id = gid
  WHERE user_id IN (u1_id, u2_id);

  RETURN gid;
END;
$$;

-- accept_challenge: use challenger's preferred_puzzle_indices from the challenge row
CREATE OR REPLACE FUNCTION public.accept_challenge(p_challenge_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge RECORD;
  v_game_id UUID;
  v_me UUID := auth.uid();
  pidx INT;
  preferred INT[];
  num_puzzles INT := 500;
BEGIN
  IF v_me IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id, c.from_user_id, c.to_user_id, c.status, c.preferred_puzzle_indices
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id AND c.to_user_id = v_me AND c.status = 'pending'
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    RETURN NULL;
  END IF;

  preferred := v_challenge.preferred_puzzle_indices;
  IF preferred IS NOT NULL AND array_length(preferred, 1) > 0 THEN
    pidx := preferred[1 + floor(random() * array_length(preferred, 1))::int];
  ELSE
    pidx := floor(random() * num_puzzles)::int;
  END IF;

  INSERT INTO public.games (puzzle_id, puzzle_index, duration_seconds, status, started_at)
  VALUES (NULL, pidx, 300, 'in_progress', now())
  RETURNING id INTO v_game_id;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.from_user_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.to_user_id, 'opponent');

  UPDATE public.challenges
  SET status = 'accepted', game_id = v_game_id, responded_at = now()
  WHERE id = p_challenge_id;

  RETURN v_game_id;
END;
$$;
