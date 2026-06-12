-- ═══════════════════════════════════════════════════════
-- SPOTD — Push Center: scheduled campaigns + behavior automations
-- Backs the admin Push page (admin-push-center.js) and /api/push-runner.
-- RLS is enabled with NO policies: only the service role (admin UI +
-- push-runner) can touch these tables.
-- ═══════════════════════════════════════════════════════

-- One-off or recurring push sends composed in the admin portal.
create table if not exists public.push_campaigns (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  url         text,
  -- {"type":"all"} | {"type":"user_ids","user_ids":[...]} |
  -- {"type":"city_slug","city_slug":"san-diego"} | {"type":"platform","platform":"ios"}
  audience    jsonb not null default '{"type":"all"}'::jsonb,
  status      text not null default 'draft'
              check (status in ('draft','scheduled','sent','canceled')),
  send_at     timestamptz,
  -- 5-field cron expression (UTC), e.g. '0 23 * * *'. When set, the runner
  -- advances send_at to the next occurrence after each send instead of
  -- marking the campaign sent.
  recurrence  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  -- {sent, total, errors} from the send (last send for recurring campaigns)
  result      jsonb
);

create index if not exists idx_push_campaigns_due
  on public.push_campaigns (status, send_at);

-- Behavior-based automations evaluated by /api/push-runner every 15 min.
create table if not exists public.push_automations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  enabled         boolean not null default true,
  trigger_type    text not null check (trigger_type in
                    ('inactive_days','first_favorite','going_tonight_threshold','new_venue_in_city')),
  -- e.g. {"days": 7} for inactive_days, {"threshold": 2} for going_tonight_threshold
  trigger_config  jsonb not null default '{}'::jsonb,
  -- Templates support {{venue_name}}, {{city}}, {{count}} placeholders
  template_title  text not null,
  template_body   text not null,
  url             text,
  -- Never send the same automation to the same user more often than this
  cooldown_hours  int not null default 72,
  created_at      timestamptz not null default now()
);

-- Per-user send log: enforces cooldowns + powers per-automation stats.
create table if not exists public.push_automation_log (
  id             bigint generated always as identity primary key,
  automation_id  uuid not null references public.push_automations(id) on delete cascade,
  user_id        uuid not null,
  sent_at        timestamptz not null default now()
);

create index if not exists idx_push_automation_log_cooldown
  on public.push_automation_log (automation_id, user_id, sent_at desc);

alter table public.push_campaigns     enable row level security;
alter table public.push_automations   enable row level security;
alter table public.push_automation_log enable row level security;
-- No policies on purpose: service-role access only.
