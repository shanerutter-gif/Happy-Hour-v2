-- Retire the weekly $25 giveaway (2026-09-29). The referral program stays.
--
-- Stops granting giveaway entries on check-ins / reviews / posts. Keeps:
--   * giveaway_entries / giveaway_winners tables + their history (read-only now)
--   * referral_codes / referrals + the trg_create_referral_code trigger
--   * is_giveaway_admin() — it is the admin gate for every "Admins manage …"
--     RLS policy and the admin portal login; do NOT drop it despite the name.

DROP TRIGGER IF EXISTS trg_checkin_giveaway      ON public.check_ins;
DROP TRIGGER IF EXISTS trg_review_giveaway       ON public.reviews;
DROP TRIGGER IF EXISTS trg_social_post_giveaway  ON public.checkin_photos;

DROP FUNCTION IF EXISTS public.trg_checkin_grant_entry();
DROP FUNCTION IF EXISTS public.trg_review_grant_entry();
DROP FUNCTION IF EXISTS public.trg_social_post_grant_entry();
DROP FUNCTION IF EXISTS public.grant_giveaway_entries(uuid, timestamptz);
