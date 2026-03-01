-- =============================================================================
-- Spellbound — Incoming challenges: RPCs and Realtime
-- Run after 005. Recipient can get pending challenges, accept (creates game), or reject.
-- =============================================================================

-- Returns pending challenges sent TO the current user (id, from_user_id, from_username, created_at).
CREATE OR REPLACE FUNCTION public.get_my_pending_challenges()
RETURNS TABLE (
  id UUID,
  from_user_id UUID,
  from_username TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.from_user_id, u.username AS from_username, c.created_at
  FROM public.challenges c
  JOIN public.users u ON u.id = c.from_user_id
  WHERE c.to_user_id = auth.uid() AND c.status = 'pending'
  ORDER BY c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_challenges() TO authenticated;

-- Accept a challenge: create game + two game_players, update challenge, return game_id.
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

  SELECT id INTO v_puzzle_id FROM public.puzzles ORDER BY created_at LIMIT 1;
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

GRANT EXECUTE ON FUNCTION public.accept_challenge(UUID) TO authenticated;

-- Enable Realtime for challenges so recipient gets notified when a challenge is inserted
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'challenges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.challenges;
  END IF;
END $$;
