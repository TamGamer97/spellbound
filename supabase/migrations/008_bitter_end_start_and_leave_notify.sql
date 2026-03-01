-- =============================================================================
-- Spellbound — One-click Continue to Bitter End; game.bitter_end_mode
-- Run after 007. When one player clicks Continue, set bitter_end_mode so the other sees it and proceeds.
-- =============================================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS bitter_end_mode VARCHAR(20)
  CHECK (bitter_end_mode IS NULL OR bitter_end_mode IN ('coop', 'competitive'));

COMMENT ON COLUMN public.games.bitter_end_mode IS 'Set when both players agreed and one clicked Continue; both then proceed to Bitter End.';

-- RPC: start Bitter End (only if both players have same bitter_end_choice). Sets games.bitter_end_mode.
CREATE OR REPLACE FUNCTION public.start_bitter_end(p_game_id UUID)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_my_choice VARCHAR(20);
  v_other_choice VARCHAR(20);
  v_mode VARCHAR(20);
BEGIN
  IF v_me IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT bitter_end_choice INTO v_my_choice
  FROM public.game_players
  WHERE game_id = p_game_id AND user_id = v_me
  LIMIT 1;

  IF v_my_choice IS NULL OR v_my_choice NOT IN ('coop', 'competitive') THEN
    RETURN NULL;
  END IF;

  SELECT bitter_end_choice INTO v_other_choice
  FROM public.game_players
  WHERE game_id = p_game_id AND user_id != v_me
  LIMIT 1;

  IF v_other_choice IS NULL OR v_other_choice != v_my_choice THEN
    RETURN NULL;
  END IF;

  UPDATE public.games
  SET bitter_end_mode = v_my_choice
  WHERE id = p_game_id AND (bitter_end_mode IS NULL);

  RETURN v_my_choice;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_bitter_end(UUID) TO authenticated;

-- Update get_game_for_player to return bitter_end_mode
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

  SELECT id, puzzle_id, duration_seconds, status, started_at, created_at, bitter_end_mode
  INTO v_game
  FROM public.games
  WHERE id = p_game_id
  LIMIT 1;

  IF v_game.id IS NULL THEN
    RETURN NULL;
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
