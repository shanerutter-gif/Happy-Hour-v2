-- Signup attribution source constraint fix (2026-10-13)
-- Run this in the Supabase SQL Editor (project: shanerutter-gif's Project).
--
-- Why: the QA proof for the business-path attribution fix (commit 79a5eb2)
-- failed end to end against the live schema:
--   * Business portal signups insert source='business_portal' and were
--     rejected with Postgres 23514 (violates signup_attributions_source_check).
--   * Consumer signups with UTMs but no onboarding survey answer inserted
--     with NO source and were rejected with Postgres 23502 (source is
--     NOT NULL). js/db.js now defaults the source to 'web' for that case,
--     so 'web' must be an allowed value too.
-- Both failures are swallowed best-effort client-side, so signups looked
-- fine while the attribution rows were silently lost.
--
-- This widens the CHECK to the full existing allowed list (confirmed from
-- the live constraint via the 23514 error) plus 'business_portal' and
-- 'web'. The NOT NULL on source is intentionally left untouched.
--
-- NOTE: the onboarding survey also offers twitter / facebook / email /
-- reddit / podcast / press, which are NOT in the live constraint today —
-- survey answers with those values are rejected as well. They are left out
-- here on purpose (out of scope for this fix); adding them is a separate,
-- deliberate decision.
--
-- Idempotent: safe to run more than once.

alter table public.signup_attributions
  drop constraint if exists signup_attributions_source_check;

alter table public.signup_attributions
  add constraint signup_attributions_source_check
  check (source in (
    'app_store',
    'google',
    'friend',
    'tiktok',
    'instagram',
    'event',
    'other',
    'referral',
    'business_portal',
    'web'
  ));
