-- ═══════════════════════════════════════════════════════
-- SPOTD CRM — Tables (safe to rerun)
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- ── CRM CONTACTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_name   text NOT NULL,
  business_name  text,
  email          text,
  phone          text,
  city_slug      text,
  stage          text DEFAULT 'lead' CHECK (stage IN ('lead','contacted','demo','proposal','won','lost')),
  venue_id       uuid REFERENCES public.venues(id),
  source         text DEFAULT 'manual',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ── CRM NOTES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_notes (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id     uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  note           text NOT NULL,
  author         text,
  created_at     timestamptz DEFAULT now()
);

-- ── CRM ACTIVITIES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_activities (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id     uuid REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  activity_type  text NOT NULL,
  description    text NOT NULL,
  meta           jsonb DEFAULT '{}',
  created_at     timestamptz DEFAULT now()
);

-- ── INDEXES ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON public.crm_contacts(stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_city ON public.crm_contacts(city_slug);
CREATE INDEX IF NOT EXISTS idx_crm_notes_contact ON public.crm_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON public.crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON public.crm_activities(activity_type);

-- ── RLS POLICIES ─────────────────────────────────────
-- Admin-only access (service role handles all CRM operations)
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on crm_contacts"
  ON public.crm_contacts FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on crm_notes"
  ON public.crm_notes FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on crm_activities"
  ON public.crm_activities FOR ALL
  USING (true) WITH CHECK (true);
