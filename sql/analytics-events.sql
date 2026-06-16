-- analytics-events.sql
-- Per-user backend event capture + admin-gated aggregation RPCs powering the
-- "User Activity" admin dashboard (admin-activity.js).
--
-- Ingest: the browser tees every track() event to /api/track-event (edge), which
-- inserts rows here with the service role key (so RLS does not block the write).
-- The signed-in user is derived server-side from the access token; guests are
-- captured against an anonymous session_id only.
--
-- Read: the admin dashboard calls the ae_* RPCs below. They are SECURITY DEFINER
-- and gated by public.is_giveaway_admin(), so only the admin can pull data even
-- though they bypass RLS. There is intentionally NO client INSERT policy — the
-- only writer is the service-role edge function.

create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  user_id     uuid,                          -- null for guests / pre-auth
  session_id  text,                          -- anonymous per-tab session
  event_name  text not null,
  props       jsonb not null default '{}'::jsonb,
  path        text,
  platform    text,                          -- 'web' | 'ios_app'
  created_at  timestamptz not null default now()
);

create index if not exists idx_ae_user_time on public.analytics_events (user_id, created_at desc);
create index if not exists idx_ae_name_time on public.analytics_events (event_name, created_at desc);
create index if not exists idx_ae_time      on public.analytics_events (created_at desc);

alter table public.analytics_events enable row level security;

-- Admin (the admin's own JWT) may read directly via PostgREST for the per-user
-- timeline / raw browsing. No INSERT/UPDATE/DELETE policies => clients cannot
-- write; ingest is service-role only.
drop policy if exists ae_admin_read on public.analytics_events;
create policy ae_admin_read on public.analytics_events
  for select using (public.is_giveaway_admin());

-- ── Aggregation RPCs (admin-gated) ───────────────────────────────────────────

-- Headline KPIs for a window.
create or replace function public.ae_kpis(p_from timestamptz, p_to timestamptz)
returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'total_events',     count(*),
      'unique_users',     count(distinct user_id) filter (where user_id is not null),
      'guest_events',     count(*) filter (where user_id is null),
      'signed_in_events', count(*) filter (where user_id is not null),
      'sessions',         count(distinct session_id),
      'event_types',      count(distinct event_name)
    )
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
  ) else null end;
$$;

-- Events + active users bucketed by hour or day.
create or replace function public.ae_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table(bucket timestamptz, events bigint, users bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*)::bigint as events,
         count(distinct user_id) filter (where user_id is not null)::bigint as users
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
  group by 1
  order by 1;
$$;

-- Most frequent events.
create or replace function public.ae_top_events(p_from timestamptz, p_to timestamptz, p_limit int)
returns table(event_name text, events bigint, users bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select event_name,
         count(*)::bigint as events,
         count(distinct user_id) filter (where user_id is not null)::bigint as users
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
  group by event_name
  order by events desc
  limit coalesce(p_limit, 20);
$$;

-- Top values of a single prop for one event (e.g. props->>'name' for venue_modal_opened).
create or replace function public.ae_breakdown(p_event text, p_prop text, p_from timestamptz, p_to timestamptz, p_limit int)
returns table(value text, events bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(props->>p_prop, ''), '(none)') as value,
         count(*)::bigint as events
  from public.analytics_events
  where public.is_giveaway_admin()
    and (p_event is null or event_name = p_event)  -- null p_event = across all events
    and created_at >= p_from and created_at < p_to
  group by 1
  order by events desc
  limit coalesce(p_limit, 15);
$$;

-- Most active signed-in users in the window.
create or replace function public.ae_active_users(p_from timestamptz, p_to timestamptz, p_limit int)
returns table(user_id uuid, display_name text, email text, events bigint, last_event timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.user_id,
         p.display_name,
         (select u.email from auth.users u where u.id = e.user_id) as email,
         count(*)::bigint as events,
         max(e.created_at) as last_event
  from public.analytics_events e
  left join public.profiles p on p.id = e.user_id
  where public.is_giveaway_admin()
    and e.user_id is not null
    and e.created_at >= p_from and e.created_at < p_to
  group by e.user_id, p.display_name
  order by events desc
  limit coalesce(p_limit, 25);
$$;

-- Find users (by name/email) for the per-user drill-down, with lifetime counts.
create or replace function public.ae_user_search(p_q text, p_limit int)
returns table(user_id uuid, display_name text, email text, events bigint, last_event timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id,
         p.display_name,
         (select u.email from auth.users u where u.id = p.id) as email,
         (select count(*)::bigint from public.analytics_events e where e.user_id = p.id) as events,
         (select max(e.created_at) from public.analytics_events e where e.user_id = p.id) as last_event
  from public.profiles p
  where public.is_giveaway_admin()
    and (
      coalesce(p_q, '') = ''
      or p.display_name ilike '%' || p_q || '%'
      or exists (select 1 from auth.users u where u.id = p.id and u.email ilike '%' || p_q || '%')
    )
  order by events desc nulls last, last_event desc nulls last
  limit coalesce(p_limit, 20);
$$;

-- Full event stream for one user (the drill-down timeline).
create or replace function public.ae_user_timeline(p_user uuid, p_limit int)
returns table(event_name text, props jsonb, path text, platform text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select event_name, props, path, platform, created_at
  from public.analytics_events
  where public.is_giveaway_admin()
    and user_id = p_user
  order by created_at desc
  limit coalesce(p_limit, 250);
$$;

grant execute on function
  public.ae_kpis(timestamptz, timestamptz),
  public.ae_timeseries(timestamptz, timestamptz, text),
  public.ae_top_events(timestamptz, timestamptz, int),
  public.ae_breakdown(text, text, timestamptz, timestamptz, int),
  public.ae_active_users(timestamptz, timestamptz, int),
  public.ae_user_search(text, int),
  public.ae_user_timeline(uuid, int)
  to anon, authenticated, service_role;
