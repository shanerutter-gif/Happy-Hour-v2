-- Signup UTM attribution columns (2026-10-05)
-- Run this in the Supabase SQL Editor (project: shanerutter-gif's Project).
-- Extends the existing signup_attributions table (user_id PK, source) so
-- marketing UTMs captured at landing are recorded at signup. All nullable;
-- the client writes them best-effort alongside the existing insert.
-- Idempotent: safe to run more than once.

alter table public.signup_attributions
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term     text,
  add column if not exists utm_content  text,
  add column if not exists referrer     text;
