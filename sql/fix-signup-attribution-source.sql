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
-- APPLIED 2026-10-13 via the SQL Editor. Before/after constraint
-- definitions were recorded with pg_get_constraintdef at apply time.
-- IMPORTANT CORRECTION to the first draft of this file: the live
-- constraint ALREADY contained all 13 survey values (the 23514 error
-- text had truncated the list, which made it look like twitter /
-- facebook / email / reddit / podcast / press were missing — they were
-- not). The migration's real additions were 'referral',
-- 'business_portal', and 'web'. Final live state: 16 values, exactly
-- the list below. This file now matches the applied migration — do not
-- re-run any older 10-value draft, it would silently re-break the six
-- survey sources.
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
    'twitter',
    'facebook',
    'email',
    'reddit',
    'podcast',
    'press',
    'referral',
    'business_portal',
    'web'
  ));
