-- Team view focus table (2026-09-29): one row per AI agent holding their
-- current focus, upserted by the /api/team-focus endpoint (service role).
-- Read by the Team page in admin.html via GET /api/team-focus.
-- Apply via the Supabase SQL editor.
CREATE TABLE IF NOT EXISTS public.agent_focus (
  agent TEXT PRIMARY KEY,
  focus TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','idle')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.agent_focus IS 'Current focus per AI agent, written by /api/team-focus; rendered on the admin portal Team page.';

-- 2026-09-30: per-agent context for the Team page. Agents POST 2-4 sentences
-- of current context (what they're working on, key findings, pending decisions)
-- rendered as an expandable "More context" block on their card.
ALTER TABLE public.agent_focus ADD COLUMN IF NOT EXISTS details TEXT;
