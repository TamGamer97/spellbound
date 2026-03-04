-- =============================================================================
-- Spellbound — Use recent board indices as exclude lists when picking puzzle.
-- try_match: exclude indices from BOTH players; pick random until not in either.
-- accept_challenge: add p_accepter_exclude_indices; exclude challenger + accepter.
-- Run after 012.
-- =============================================================================

-- try_match: get both players' preferred_puzzle_indices (exclude lists), pick random index not in either
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
  excluded INT[] := '{}';
  pidx INT;
  num_puzzles INT := 824;
  i INT;
BEGIN
  FOR r IN
    SELECT user_id, COALESCE(preferred_puzzle_indices, '{}') AS exc
    FROM public.matchmaking_queue
    WHERE matched_game_id IS NULL
    ORDER BY joined_at
    FOR UPDATE SKIP LOCKED
    LIMIT 2
  LOOP
    IF n = 0 THEN u1_id := r.user_id; END IF;
    IF n = 1 THEN u2_id := r.user_id; END IF;
    excluded := array_cat(excluded, r.exc);
    n := n + 1;
  END LOOP;

  IF n < 2 OR u1_id IS NULL OR u2_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pick random index not in excluded; retry up to 200 times
  pidx := floor(random() * num_puzzles)::int;
  FOR i IN 1..200 LOOP
    IF NOT (pidx = ANY(excluded)) THEN
      EXIT;
    END IF;
    pidx := floor(random() * num_puzzles)::int;
  END LOOP;

  -- Clamp to valid range (0 .. num_puzzles-1)
  IF pidx < 0 OR pidx >= num_puzzles THEN
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

-- accept_challenge: add accepter's exclude list; pick random index not in challenger's or accepter's recent
CREATE OR REPLACE FUNCTION public.accept_challenge(p_challenge_id UUID, p_accepter_exclude_indices INT[] DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge RECORD;
  v_game_id UUID;
  v_me UUID := auth.uid();
  excluded INT[];
  pidx INT;
  num_puzzles INT := 824;
  i INT;
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

  excluded := array_cat(
    COALESCE(v_challenge.preferred_puzzle_indices, '{}'),
    COALESCE(p_accepter_exclude_indices, '{}')
  );

  pidx := floor(random() * num_puzzles)::int;
  FOR i IN 1..200 LOOP
    IF NOT (pidx = ANY(excluded)) THEN
      EXIT;
    END IF;
    pidx := floor(random() * num_puzzles)::int;
  END LOOP;

  IF pidx < 0 OR pidx >= num_puzzles THEN
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

COMMENT ON COLUMN public.matchmaking_queue.preferred_puzzle_indices IS 'Puzzle indices to exclude (user recent boards).';
COMMENT ON COLUMN public.challenges.preferred_puzzle_indices IS 'Challenger puzzle indices to exclude when picking board on accept.';
