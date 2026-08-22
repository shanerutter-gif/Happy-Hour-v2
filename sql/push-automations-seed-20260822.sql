-- ══════════════════════════════════════════════════════════
-- C5 · Seed the Push Center automation engine (2026-08-22)
--
-- `push_automations` had been EMPTY since the table shipped 2026-06-12, so the
-- /api/push-runner cron has been waking every 15 minutes for two months with
-- nothing to evaluate. Spotd has never sent an automated re-engagement push.
--
-- These four cover the triggers the runner already implements. Placeholders are
-- limited to what each trigger actually supplies:
--   inactive_days           → {{count}} (the day threshold)
--   first_favorite          → {{venue_name}}, {{city}}
--   going_tonight_threshold → {{venue_name}}, {{count}}, {{city}}
--   new_venue_in_city       → {{venue_name}}, {{city}}
-- Using a placeholder a trigger does not supply renders it blank.
--
-- SEEDED DISABLED ON PURPOSE. `push_automations` is the table the admin Push
-- Center tab (admin-push-center.js) already does full CRUD on, so these four
-- land in Tools -> Push Center -> Automations ready to review, edit and switch
-- on with the toggle there. Nothing sends until you do — a push cannot be
-- unsent, and 'Win-back - quiet 3 days' would otherwise fire at nearly every
-- dormant user within 15 minutes of the next cron run.
--
-- Idempotent: each row is skipped if an automation with that name already
-- exists (there is no unique index on `name`, so `on conflict` cannot do it).
-- ══════════════════════════════════════════════════════════

insert into public.push_automations
  (name, enabled, trigger_type, trigger_config, template_title, template_body, url, cooldown_hours)
select v.* from (values
  -- The workhorse. 3 days is deliberately short for a "where do I go tonight"
  -- app — a week-old nudge is a week of nights missed.
  ('Win-back · quiet 3 days', false, 'inactive_days', '{"days": 3}'::jsonb,
   'Happy hour''s on right now',
   'It''s been {{count}} days. See which spots near you are pouring tonight.',
   '/', 96),

  -- Someone saved their first spot: the single strongest intent signal we get.
  ('First save · follow up', false, 'first_favorite', '{}'::jsonb,
   'Saved {{venue_name}} 👀',
   'We''ll tell you when their happy hour starts. Here''s what else is good in {{city}} tonight.',
   '/', 168),

  -- Social proof, the only automation that can say something genuinely timely.
  ('Busy tonight · 3+ checked in', false, 'going_tonight_threshold', '{"threshold": 3}'::jsonb,
   '{{count}} people are at {{venue_name}}',
   'Something''s happening in {{city}} tonight. Take a look.',
   '/', 48),

  -- Fires only on real venue additions, so it stays rare by construction.
  ('New spot in your city', false, 'new_venue_in_city', '{}'::jsonb,
   'New in {{city}}: {{venue_name}}',
   'Just added to Spotd. See their deals.',
   '/', 168)
) as v(name, enabled, trigger_type, trigger_config, template_title, template_body, url, cooldown_hours)
where not exists (
  select 1 from public.push_automations a where a.name = v.name
);
