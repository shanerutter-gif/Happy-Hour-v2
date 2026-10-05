-- Analytics dashboards storage (2026-10-05) — backs the admin portal's
-- "📊 Social Analytics" and "✉️ Email Analytics" sections
-- (admin-social-analytics.js / admin-email-analytics.js).
--
-- HOW TO APPLY (the shell has no Supabase access, so this runs by hand):
--   1. Open the Supabase dashboard for the Spotd project → SQL Editor.
--   2. Paste this entire file into a new query and run it.
--   3. Verify: `select count(*) from public.social_daily_metrics;` etc.
--      should return 0 with no error, and the four tables should appear
--      under Database → Tables.
--
-- DATA FLOW:
--   A daily cron (spec: docs/analytics-dashboards-ops.md) pulls numbers from
--   Instagram (instagram-cli), TikTok Studio (browser), and Loops (browser),
--   then POSTs them to /api/metrics-ingest.js, which upserts here using the
--   service-role key server-side. The portal reads via the signed-in admin's
--   JWT under the "Admins read analytics" RLS policies below (same
--   public.is_giveaway_admin() allow-list pattern as sql/admin-rls-20260711.sql).
--
-- AUTH NOTES:
--   * RLS is enabled on all four tables. Service role bypasses RLS, so the
--     ingest endpoint needs no policy — it must use SUPABASE_SERVICE_KEY.
--   * The ingest endpoint is additionally gated by the METRICS_INGEST_TOKEN
--     env var (x-ingest-token header), mirroring AGENT_LOG_TOKEN. Generate
--     with:  openssl rand -hex 32
--     Set it as a Vercel env var on the Spotd project. NEVER commit the
--     token to the repo — the generated value lives at
--     ~/workspace/goals/grow-and-monetize-spotd/hidden_files/metrics-ingest-token.txt
--     (workspace only).

-- ── 1. social_daily_metrics: one row per platform per day ────────────────
CREATE TABLE IF NOT EXISTS public.social_daily_metrics (
  day            DATE        NOT NULL,
  platform       TEXT        NOT NULL CHECK (platform IN ('tiktok', 'instagram')),
  followers      INTEGER,
  views          BIGINT,
  reach          BIGINT,
  interactions   BIGINT,
  profile_visits INTEGER,
  posts_published INTEGER,
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_daily_metrics_pkey PRIMARY KEY (day, platform)
);
COMMENT ON TABLE public.social_daily_metrics IS
  'Daily social rollups (TikTok Studio + Instagram), written by /api/metrics-ingest.js; read by the portal Social Analytics section. NULLs mean the source does not expose that metric.';

-- ── 2. social_post_metrics: per-post stats (upserted daily, keeps latest) ────────
CREATE TABLE IF NOT EXISTS public.social_post_metrics (
  platform       TEXT        NOT NULL CHECK (platform IN ('tiktok', 'instagram')),
  post_id        TEXT        NOT NULL,
  posted_at      TIMESTAMPTZ,
  url            TEXT,
  caption_snippet TEXT,
  views          BIGINT,
  likes          INTEGER,
  comments       INTEGER,
  shares         INTEGER,
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_post_metrics_pkey PRIMARY KEY (platform, post_id)
);
COMMENT ON TABLE public.social_post_metrics IS
  'Per-post social stats (latest snapshot per post), written by /api/metrics-ingest.js; powers the Top Posts table. Instagram does not expose per-post views/shares via the CLI — those stay NULL.';

-- ── 3. email_daily_metrics: one row per Loops workflow per day ────────────
CREATE TABLE IF NOT EXISTS public.email_daily_metrics (
  day          DATE        NOT NULL,
  workflow     TEXT        NOT NULL,
  sends        INTEGER,
  opens        INTEGER,
  clicks       INTEGER,
  unsubscribes INTEGER,
  bounces      INTEGER,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_daily_metrics_pkey PRIMARY KEY (day, workflow)
);
COMMENT ON TABLE public.email_daily_metrics IS
  'Daily email rollups per Loops workflow, written by /api/metrics-ingest.js; read by the portal Email Analytics section.';

-- ── 4. email_campaigns: one-off / broadcast campaigns ────────────────────
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  provider_id  TEXT        NOT NULL PRIMARY KEY,
  name         TEXT,
  subject      TEXT,
  sent_at      TIMESTAMPTZ,
  sends        INTEGER,
  opens        INTEGER,
  clicks       INTEGER,
  unsubscribes INTEGER,
  bounces      INTEGER,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.email_campaigns IS
  'Loops one-off/broadcast campaigns (latest snapshot per campaign), written by /api/metrics-ingest.js; powers the Recent Campaigns table.';

-- ── 5. RLS: admin reads only; writes via service role (bypasses RLS) ─────
ALTER TABLE public.social_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_metrics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read social_daily_metrics" ON public.social_daily_metrics;
CREATE POLICY "Admins read social_daily_metrics" ON public.social_daily_metrics
  FOR SELECT TO authenticated USING (public.is_giveaway_admin());

DROP POLICY IF EXISTS "Admins read social_post_metrics" ON public.social_post_metrics;
CREATE POLICY "Admins read social_post_metrics" ON public.social_post_metrics
  FOR SELECT TO authenticated USING (public.is_giveaway_admin());

DROP POLICY IF EXISTS "Admins read email_daily_metrics" ON public.email_daily_metrics;
CREATE POLICY "Admins read email_daily_metrics" ON public.email_daily_metrics
  FOR SELECT TO authenticated USING (public.is_giveaway_admin());

DROP POLICY IF EXISTS "Admins read email_campaigns" ON public.email_campaigns;
CREATE POLICY "Admins read email_campaigns" ON public.email_campaigns
  FOR SELECT TO authenticated USING (public.is_giveaway_admin());
