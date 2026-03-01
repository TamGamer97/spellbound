-- =============================================================================
-- Spellbound — Bitter End choice per player (both must agree to continue)
-- Run after 006.
-- =============================================================================

ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS bitter_end_choice VARCHAR(20)
  CHECK (bitter_end_choice IS NULL OR bitter_end_choice IN ('coop', 'competitive'));

COMMENT ON COLUMN public.game_players.bitter_end_choice IS 'Player choice for The Bitter End; game continues only when both players choose the same.';
