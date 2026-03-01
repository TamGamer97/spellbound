-- =============================================================================
-- Spellbound — Fix game_players RLS 500 (remove self-referential policy)
-- Run after 004. Uses a helper so SELECT/UPDATE on game_players don't 500.
-- =============================================================================

-- Helper: true if the given user (default current) is in the given game.
-- SECURITY DEFINER so it can read game_players without triggering RLS recursion.
CREATE OR REPLACE FUNCTION public.user_in_game(p_game_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_in_game(UUID, UUID) TO authenticated;

-- Drop the old SELECT policy that referenced game_players inside the policy
DROP POLICY IF EXISTS "game_players_select_own" ON public.game_players;

-- Allow read if it's your row, or you're in the same game (see opponent)
CREATE POLICY "game_players_select_own" ON public.game_players
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_in_game(game_id)
  );

-- Ensure UPDATE policy is simple (no recursion)
DROP POLICY IF EXISTS "game_players_update_own" ON public.game_players;

CREATE POLICY "game_players_update_own" ON public.game_players
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON FUNCTION public.user_in_game(UUID, UUID) IS 'Used by game_players RLS to avoid self-reference; returns true if user is in the game.';
