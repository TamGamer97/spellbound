-- =============================================================================
-- Spellbound — Set game finished when round ends; more puzzles + random pick
-- Run after 008.
-- =============================================================================

-- RPC: mark game as finished (status, ended_at). Only if current user is in the game.
CREATE OR REPLACE FUNCTION public.set_game_finished(p_game_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_game BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = auth.uid()
  ) INTO v_in_game;

  IF NOT v_in_game THEN
    RETURN FALSE;
  END IF;

  UPDATE public.games
  SET status = 'finished', ended_at = now()
  WHERE id = p_game_id AND status = 'in_progress';

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_game_finished(UUID) TO authenticated;

COMMENT ON FUNCTION public.set_game_finished(UUID) IS 'Marks game as finished and sets ended_at; only for players in the game.';

-- =============================================================================
-- Pick random puzzle when creating games (try_match and accept_challenge)
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
  SELECT id INTO pid FROM public.puzzles ORDER BY RANDOM() LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.accept_challenge(p_challenge_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge RECORD;
  v_puzzle_id UUID;
  v_game_id UUID;
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id, c.from_user_id, c.to_user_id, c.status
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id AND c.to_user_id = v_me AND c.status = 'pending'
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_puzzle_id FROM public.puzzles ORDER BY RANDOM() LIMIT 1;
  IF v_puzzle_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.games (puzzle_id, duration_seconds, status, started_at)
  VALUES (v_puzzle_id, 600, 'in_progress', now())
  RETURNING id INTO v_game_id;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.from_user_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.to_user_id, 'opponent');

  UPDATE public.challenges
  SET status = 'accepted', game_id = v_game_id, responded_at = now()
  WHERE id = p_challenge_id;

  RETURN v_game_id;
END;
$$;

-- =============================================================================
-- Additional puzzles (200+ points) so games use variety from Supabase
-- =============================================================================

INSERT INTO public.puzzles (center_letter, outer_letters, valid_words, pangrams, total_points)
VALUES
  (
    'I',
    'NGSTER',
    '["STING","RING","RISE","TIRE","SIGN","GRIN","GRIT","REST","NEST","TING","GRINS","STINGER","RESTING","GINS","GIST","RINS","SITE","TIER","TINS","GITS","GIRT","SIREN","REINS","RESIN","INTER","INERT","NITER","NITRE","TIGER","GRIST","TRIES","SIRE","SING","NETS","TENS","RIGS","STIR","TIES","RETS","NITS"]'::jsonb,
    '["STINGER","RESTING","INTER","INERT","NITER","NITRE"]'::jsonb,
    220
  ),
  (
    'O',
    'LNDWER',
    '["LOW","OWL","WOE","OWED","LODE","WOOD","WOOL","DOLE","LOON","DOOR","WOOD","LORD","WORD","WOLD","DOWEL","WOODEN","LOWDOWN","WOODED","WOODEN","LOWN","OWES","OWED","LOWS","DOW","OWL","WOE","OLD","END","ONE","OWE","LOW","DON","NOW","NEW","LED","LEW","WON","DOE","ODE","LODE","LONE","LEND","LENT","LOWE","WELD","WEND","WENT","LOWED","OWED","DONE","NOEL","ENOW","LOWE","WOOD","WOOL","DOOR","LOOR","LORD","WORD","WOLD","WOODED","WOODEN","LOWN","DOWEL","LOWDOWN"]'::jsonb,
    '["LOWDOWN","WOODEN"]'::jsonb,
    205
  )
;
-- Run the INSERT above once; re-running will add duplicate puzzles (same letters, new ids).
