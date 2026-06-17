-- analytics-retention.sql
-- Long-term daily rollup + raw-event retention pruning for analytics_events.
-- Applied via MCP (apply_migration analytics_retention_rollup). Driven by the
-- /api/analytics-rollup cron (daily 09:30 UTC).
--
-- Raw events keep full detail (per-page, per-source breakdowns, per-user
-- timelines) for RETENTION days; older rows are deleted AFTER their headline
-- metrics are preserved in analytics_daily, so long-term trend lines survive
-- while the raw table stays bounded as site-wide traffic grows.

create table if not exists public.analytics_daily (
  day              date primary key,
  pageviews        bigint not null default 0,
  sessions         bigint not null default 0,
  visitors         bigint not null default 0,
  events           bigint not null default 0,
  signups          bigint not null default 0,
  signed_in_users  bigint not null default 0,
  updated_at       timestamptz not null default now()
);

alter table public.analytics_daily enable row level security;
drop policy if exists ae_daily_admin_read on public.analytics_daily;
create policy ae_daily_admin_read on public.analytics_daily
  for select using (public.is_giveaway_admin());

-- Roll the last p_recent_days of raw events into analytics_daily (idempotent
-- upsert so late-arriving events are re-captured), then delete raw events older
-- than p_retention_days. service_role only (called by the cron with the service key).
create or replace function public.ae_rollup_and_prune(p_retention_days int default 180, p_recent_days int default 3)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rolled int := 0;
  v_pruned int := 0;
begin
  insert into public.analytics_daily as d (day, pageviews, sessions, visitors, events, signups, signed_in_users, updated_at)
  select date_trunc('day', created_at)::date as day,
         count(*) filter (where event_name = 'page_view'),
         count(distinct session_id),
         count(distinct visitor_id),
         count(*),
         count(*) filter (where event_name in ('signup_completed','signup')),
         count(distinct user_id) filter (where user_id is not null),
         now()
  from public.analytics_events
  where created_at >= (now() - make_interval(days => greatest(p_recent_days, 1)))
  group by 1
  on conflict (day) do update set
    pageviews = excluded.pageviews, sessions = excluded.sessions,
    visitors = excluded.visitors, events = excluded.events,
    signups = excluded.signups, signed_in_users = excluded.signed_in_users,
    updated_at = now();
  get diagnostics v_rolled = row_count;

  delete from public.analytics_events
  where created_at < (now() - make_interval(days => greatest(p_retention_days, 30)));
  get diagnostics v_pruned = row_count;

  return json_build_object('days_rolled', v_rolled, 'rows_pruned', v_pruned, 'retention_days', greatest(p_retention_days, 30));
end;
$$;

revoke all on function public.ae_rollup_and_prune(int, int) from public, anon, authenticated;
grant execute on function public.ae_rollup_and_prune(int, int) to service_role;

-- Admin-gated read of the long-term daily summary (trend views beyond the raw window).
create or replace function public.ae_daily(p_from date, p_to date)
returns table(day date, pageviews bigint, sessions bigint, visitors bigint, events bigint, signups bigint, signed_in_users bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select day, pageviews, sessions, visitors, events, signups, signed_in_users
  from public.analytics_daily
  where public.is_giveaway_admin() and day >= p_from and day <= p_to
  order by day;
$$;
grant execute on function public.ae_daily(date, date) to anon, authenticated, service_role;
