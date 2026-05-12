-- enrichment_runs.sql
-- Tracks every Google Places enrichment pass per venue. Used by the admin
-- "Venue Enrichment" tab to:
--   1. Idempotency — skip venues enriched in the last N days unless forced
--   2. Cost tracking — sum cost_usd_micro per run
--   3. Audit — what fields were filled, where they came from, when

CREATE TABLE IF NOT EXISTS public.enrichment_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  city_slug       TEXT,
  status          TEXT NOT NULL CHECK (status IN ('success','failed','no_match','dry_run','skipped')),
  source          TEXT NOT NULL DEFAULT 'google_places',
  place_id        TEXT,
  photo_count     INT  NOT NULL DEFAULT 0,
  fields_filled   TEXT[] NOT NULL DEFAULT '{}',
  error           TEXT,
  cost_usd_micro  INT  NOT NULL DEFAULT 0,  -- micro-USD (1e-6 USD) for fine-grained cost tracking
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_venue
  ON public.enrichment_runs (venue_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_status
  ON public.enrichment_runs (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_city
  ON public.enrichment_runs (city_slug, started_at DESC);

ALTER TABLE public.enrichment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read enrichment_runs" ON public.enrichment_runs;
CREATE POLICY "admins read enrichment_runs"
  ON public.enrichment_runs
  FOR SELECT
  TO authenticated
  USING (public.is_giveaway_admin());

-- Service role inserts/updates only (the edge function uses service key, bypasses RLS).

-- Helper view: latest enrichment per venue + cost rollup
CREATE OR REPLACE VIEW public.venue_enrichment_status AS
SELECT
  v.id              AS venue_id,
  v.name,
  v.neighborhood,
  v.city_slug,
  v.photo_url,
  v.place_id,
  v.google_rating,
  v.phone,
  (v.photo_url IS NOT NULL AND v.photo_url <> '') AS has_photo,
  (v.place_id  IS NOT NULL AND v.place_id  <> '') AS enriched,
  latest.status     AS last_status,
  latest.started_at AS last_run_at,
  latest.error      AS last_error
FROM public.venues v
LEFT JOIN LATERAL (
  SELECT status, started_at, error
  FROM public.enrichment_runs r
  WHERE r.venue_id = v.id
  ORDER BY r.started_at DESC
  LIMIT 1
) latest ON true
WHERE v.active = true;

GRANT SELECT ON public.venue_enrichment_status TO authenticated;
