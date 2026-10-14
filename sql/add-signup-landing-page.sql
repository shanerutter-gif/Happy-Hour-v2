-- Signup attribution: landing page column (2026-10-14)
-- Run this in the Supabase SQL Editor (project: shanerutter-gif's Project).
--
-- Why: the client now writes a signup_attributions row for EVERY signup
-- (previously only UTM-tagged or survey-answered signups got one). Each row
-- carries the landing page path where the session's journey started
-- (first-touch, captured at first page load in js/db.js capturePendingUtm),
-- alongside the existing referrer and utm_* columns.
--
-- NOT YET APPLIED as of the code deploy (2026-10-14). The client degrades
-- gracefully without it: PostgREST rejects the unknown column with
-- PGRST204, applyPendingAttribution drops landing_page and retries, so rows
-- still land (without the landing page) until this runs. Apply when
-- convenient; no data is lost either way beyond the landing_page value
-- itself for signups in the interim.
--
-- Idempotent: safe to run more than once.

alter table public.signup_attributions
  add column if not exists landing_page text;
