-- =============================================================================
-- Spellbound — Use local puzzle set: games store puzzle_index (0..14) instead of puzzle_id.
-- Client loads data/puzzles.json and uses puzzles[puzzle_index].
-- Run after 009.
-- =============================================================================

-- Allow games to use either puzzle_id (legacy) or puzzle_index (local JSON)
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS puzzle_index INT;

ALTER TABLE public.games
  ALTER COLUMN puzzle_id DROP NOT NULL;

COMMENT ON COLUMN public.games.puzzle_index IS 'Index into client-side puzzles.json (0..14); used when puzzle_id is NULL.';

-- Matchmaking: pick random index 0..14 instead of random row from puzzles table
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
BEGIN
  pidx := floor(random() * 15)::int;  -- 0..14 for 15 puzzles in data/puzzles.json

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

  INSERT INTO public.games (puzzle_id, puzzle_index, duration_seconds, status, started_at)
  VALUES (NULL, pidx, 600, 'in_progress', now())
  RETURNING id INTO gid;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u1_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (gid, u2_id, 'opponent');

  UPDATE public.matchmaking_queue
  SET matched_game_id = gid
  WHERE user_id IN (u1_id, u2_id);

  RETURN gid;
END;
$$;

-- Challenge accept: same — random puzzle index 0..14
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

  pidx := floor(random() * 15)::int;

  INSERT INTO public.games (puzzle_id, puzzle_index, duration_seconds, status, started_at)
  VALUES (NULL, pidx, 600, 'in_progress', now())
  RETURNING id INTO v_game_id;

  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.from_user_id, 'player');
  INSERT INTO public.game_players (game_id, user_id, role) VALUES (v_game_id, v_challenge.to_user_id, 'opponent');

  UPDATE public.challenges
  SET status = 'accepted', game_id = v_game_id, responded_at = now()
  WHERE id = p_challenge_id;

  RETURN v_game_id;
END;
$$;

-- Return game + puzzle_index when using local puzzles; game + puzzle when puzzle_id is set (legacy)
CREATE OR REPLACE FUNCTION public.get_game_for_player(p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_game RECORD;
  v_puzzle RECORD;
  v_in_game BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = v_user_id
  ) INTO v_in_game;

  IF NOT v_in_game THEN
    RETURN NULL;
  END IF;

  SELECT id, puzzle_id, puzzle_index, duration_seconds, status, started_at, created_at, bitter_end_mode
  INTO v_game
  FROM public.games
  WHERE id = p_game_id
  LIMIT 1;

  IF v_game.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Local puzzles: return puzzle_index; client uses data/puzzles.json[puzzle_index]
  IF v_game.puzzle_index IS NOT NULL THEN
    RETURN json_build_object(
      'game', json_build_object(
        'id', v_game.id,
        'puzzle_id', v_game.puzzle_id,
        'puzzle_index', v_game.puzzle_index,
        'duration_seconds', v_game.duration_seconds,
        'status', v_game.status,
        'started_at', v_game.started_at,
        'created_at', v_game.created_at,
        'bitter_end_mode', v_game.bitter_end_mode
      ),
      'puzzle_index', v_game.puzzle_index
    );
  END IF;

  -- Legacy: puzzle from DB
  SELECT id, center_letter, outer_letters, valid_words, pangrams
  INTO v_puzzle
  FROM public.puzzles
  WHERE id = v_game.puzzle_id
  LIMIT 1;

  IF v_puzzle.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'game', json_build_object(
      'id', v_game.id,
      'puzzle_id', v_game.puzzle_id,
      'duration_seconds', v_game.duration_seconds,
      'status', v_game.status,
      'started_at', v_game.started_at,
      'created_at', v_game.created_at,
      'bitter_end_mode', v_game.bitter_end_mode
    ),
    'puzzle', json_build_object(
      'id', v_puzzle.id,
      'center_letter', v_puzzle.center_letter,
      'outer_letters', v_puzzle.outer_letters,
      'valid_words', v_puzzle.valid_words,
      'pangrams', v_puzzle.pangrams
    )
  );
END;
$$;
