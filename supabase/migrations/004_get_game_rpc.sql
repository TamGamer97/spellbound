-- =============================================================================
-- Spellbound — RPC to fetch game + puzzle (avoids RLS 500 on direct games select)
-- Run after 003. Use this from the client instead of querying games + puzzles directly.
-- =============================================================================

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

  SELECT id, puzzle_id, duration_seconds, status, started_at, created_at
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
      'created_at', v_game.created_at
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

GRANT EXECUTE ON FUNCTION public.get_game_for_player(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_game_for_player(UUID) TO service_role;

COMMENT ON FUNCTION public.get_game_for_player(UUID) IS 'Returns game and puzzle for a game the current user is in; avoids RLS on games/puzzles.';
