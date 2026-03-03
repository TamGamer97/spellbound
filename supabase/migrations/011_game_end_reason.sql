-- =============================================================================
-- Spellbound — Store why the game ended so both players see the same message.
-- Run after 010.
-- =============================================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS end_reason TEXT;

COMMENT ON COLUMN public.games.end_reason IS 'Why round ended: time_up | all_words_found. Shown to both players.';

-- RPC: mark game finished with optional reason (so opponent shows "All words found!" too)
CREATE OR REPLACE FUNCTION public.set_game_finished(p_game_id UUID, p_end_reason TEXT DEFAULT 'time_up')
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
  SET status = 'finished', ended_at = now(), end_reason = COALESCE(NULLIF(TRIM(p_end_reason), ''), 'time_up')
  WHERE id = p_game_id AND status = 'in_progress';

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_game_finished(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_game_finished(UUID, TEXT) IS 'Marks game finished and sets end_reason so both players see same message.';

-- Lightweight RPC for opponent to poll: when status is finished, show end_reason message and stop clock
CREATE OR REPLACE FUNCTION public.get_game_status(p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_game BOOLEAN;
  v_status TEXT;
  v_end_reason TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = auth.uid()
  ) INTO v_in_game;

  IF NOT v_in_game THEN
    RETURN NULL;
  END IF;

  SELECT status, COALESCE(end_reason, 'time_up')
  INTO v_status, v_end_reason
  FROM public.games
  WHERE id = p_game_id
  LIMIT 1;

  RETURN json_build_object('status', v_status, 'end_reason', v_end_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_game_status(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_game_status(UUID) IS 'Returns status and end_reason for polling so opponent ends with same message.';

-- Include end_reason in get_game_for_player so initial load has it
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

  SELECT id, puzzle_id, puzzle_index, duration_seconds, status, started_at, created_at, bitter_end_mode, end_reason
  INTO v_game
  FROM public.games
  WHERE id = p_game_id
  LIMIT 1;

  IF v_game.id IS NULL THEN
    RETURN NULL;
  END IF;

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
        'bitter_end_mode', v_game.bitter_end_mode,
        'end_reason', v_game.end_reason
      ),
      'puzzle_index', v_game.puzzle_index
    );
  END IF;

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
      'bitter_end_mode', v_game.bitter_end_mode,
      'end_reason', v_game.end_reason
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
