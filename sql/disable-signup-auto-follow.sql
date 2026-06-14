-- Disable auto-follow of official accounts.
--
-- Previously, every new signup was force-followed onto every is_official=true
-- account (currently only Shane's personal "Shane" account), and flipping any
-- account to official retroactively force-followed all existing users onto it.
-- This felt weird to new users, so the auto-follow behavior is turned off.
--
-- This does NOT touch:
--   * profiles.is_official / the orange "✓ Spotd" badge (rendered live from the
--     profile row; Shane stays official and badged)
--   * existing user_follows rows (people already following stay following)
--
-- The trigger FUNCTIONS (trg_new_profile_follow_officials,
-- trg_official_flip_backfill_follows, follow_all_official_accounts) are left in
-- place so the behavior can be re-enabled later by re-creating the triggers.
--
-- Applied to prod via Supabase migration `disable_signup_auto_follow_officials`.

DROP TRIGGER IF EXISTS trg_new_profile_follow_officials ON public.profiles;
DROP TRIGGER IF EXISTS trg_official_flip_backfill_follows ON public.profiles;
