-- analytics-bot-traffic.sql
-- Bot-vs-human traffic split for the admin Traffic Analytics dashboard
-- (spec: hidden_files/bot-traffic-dashboard-spec-2026-10-09.md; Shane's call
-- 2026-10-12: "build it in dash and ship when done").
--
-- Classification mirrors the edge bot gate (api/_lib/botgate.js) EXACTLY —
-- same allowlist, same blocklist, same order — so the dashboard and the
-- blocklist can never disagree:
--   'blocked' — empty UA, or a gate blocklist signature (python-requests,
--               scrapy, curl, wget, mj12bot, ahrefsbot, …)
--   'bot'     — gate allowlist crawlers (Googlebot, Bingbot, GPTBot, Claude,
--               Perplexity, …) — the crawlers we WANT indexing us
--   'unknown' — NULL UA (every row captured before user_agent existed).
--               NEVER silently folded into human (spec honesty rule).
--   'human'   — everything else.
--
-- Counted events = page_view rows + 'bot_hit' rows. bot_hit rows are written
-- by api/track-event.js (one per dropped bot batch) for requests the ingest
-- bot filter rejected, so blocked junk and JS-rendering crawlers still show
-- up here even though they never become page_views. Blocked page hits at the
-- edge gate itself (404 before any page renders) live in Vercel logs as
-- "[botgate] blocked" lines — they are NOT in this table and the UI says so.
--
-- Apply like the other analytics-*.sql files (Supabase SQL editor / MCP).
-- Until applied, the dashboard panel shows SUSPECT — never zeros.

alter table public.analytics_events add column if not exists user_agent text;

create index if not exists idx_ae_ua_time
  on public.analytics_events (user_agent, created_at desc);

-- ── classification (keep in lockstep with api/_lib/botgate.js) ────────────
-- Postgres ~* is case-insensitive regex match, mirroring the JS /i flag.
-- JS \/ is a plain / in Postgres; \b works in both engines.
create or replace function public._ae_bot_bucket(p_ua text)
returns text language sql immutable as $$
  select case
    when p_ua is null then 'unknown'
    when btrim(p_ua) = '' then 'blocked'
    when p_ua ~* '(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|oai-searchbot|chatgpt-user|gptbot|perplexitybot|perplexity-user|claudebot|claude-searchbot|claude-user|google-extended|applebot-extended|applebot)' then 'bot'
    when p_ua ~* '(python-requests|scrapy|aiohttp|httpx/|wget|curl|go-http-client|\yjava/\y|libwww-perl|httpunit|nutch|mj12bot|ahrefsbot|semrushbot|dotbot|petalbot|bytespider|serpstat|dataforseo)' then 'blocked'
    else 'human'
  end;
$$;

-- Display name for an allowlisted crawler UA (first match wins).
create or replace function public._ae_bot_name(p_ua text)
returns text language sql immutable as $$
  select case
    when p_ua ~* 'googlebot' then 'Googlebot'
    when p_ua ~* 'bingbot' then 'Bingbot'
    when p_ua ~* '(oai-searchbot|chatgpt-user|gptbot)' then 'OpenAI (GPTBot / ChatGPT)'
    when p_ua ~* '(claudebot|claude-searchbot|claude-user)' then 'Claude (Anthropic)'
    when p_ua ~* 'perplexity' then 'Perplexity'
    when p_ua ~* 'duckduckbot' then 'DuckDuckBot'
    when p_ua ~* '(applebot|google-extended)' then 'Applebot / Google-Extended'
    when p_ua ~* '(slurp|baiduspider|yandexbot|sogou|exabot)' then 'Other search crawler'
    else 'Other crawler'
  end;
$$;

-- Display name for the blocklist signature a blocked UA matched.
create or replace function public._ae_blocked_pattern(p_ua text)
returns text language sql immutable as $$
  select case
    when p_ua is null or btrim(p_ua) = '' then 'empty UA'
    when p_ua ~* 'python-requests' then 'python-requests'
    when p_ua ~* 'scrapy' then 'scrapy'
    when p_ua ~* 'aiohttp' then 'aiohttp'
    when p_ua ~* 'httpx/' then 'httpx'
    when p_ua ~* 'wget' then 'wget'
    when p_ua ~* 'curl' then 'curl'
    when p_ua ~* 'go-http-client' then 'go-http-client'
    when p_ua ~* '\yjava/\y' then 'java'
    when p_ua ~* 'libwww-perl' then 'libwww-perl'
    when p_ua ~* 'httpunit' then 'httpunit'
    when p_ua ~* 'nutch' then 'nutch'
    when p_ua ~* 'mj12bot' then 'mj12bot'
    when p_ua ~* 'ahrefsbot' then 'ahrefsbot'
    when p_ua ~* 'semrushbot' then 'semrushbot'
    when p_ua ~* 'dotbot' then 'dotbot'
    when p_ua ~* 'petalbot' then 'petalbot'
    when p_ua ~* 'bytespider' then 'bytespider'
    when p_ua ~* '(serpstat|dataforseo)' then 'SEO scraper (serpstat/dataforseo)'
    else 'other blocked signature'
  end;
$$;

-- ── KPIs: pageviews / sessions / visitors per bucket ──────────────────────
create or replace function public.ae_bot_kpis(p_from timestamptz, p_to timestamptz, p_surface text default 'all')
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'total_pageviews',   count(*) filter (where b.bucket is not null),
      'human_pageviews',   count(*) filter (where b.bucket = 'human'),
      'bot_pageviews',     count(*) filter (where b.bucket = 'bot'),
      'blocked_pageviews', count(*) filter (where b.bucket = 'blocked'),
      'unknown_pageviews', count(*) filter (where b.bucket = 'unknown'),
      'human_sessions',    count(distinct session_id) filter (where b.bucket = 'human'),
      'human_visitors',    count(distinct visitor_id) filter (where b.bucket = 'human'),
      'human_share',       case when count(*) = 0 then null else
                             round(100.0 * count(*) filter (where b.bucket = 'human') / count(*), 1) end
    )
    from (
      select public._ae_bot_bucket(user_agent) as bucket, session_id, visitor_id
      from public.analytics_events
      where created_at >= p_from and created_at < p_to
        and event_name in ('page_view', 'bot_hit')
        and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
    ) b
  ) else null end;
$$;

-- ── Timeseries: stacked pageviews per bucket ──────────────────────────────
create or replace function public.ae_bot_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text, p_surface text default 'all')
returns table(bucket timestamptz, human bigint, bots bigint, blocked bigint, unknown bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*) filter (where public._ae_bot_bucket(user_agent) = 'human')::bigint   as human,
         count(*) filter (where public._ae_bot_bucket(user_agent) = 'bot')::bigint     as bots,
         count(*) filter (where public._ae_bot_bucket(user_agent) = 'blocked')::bigint as blocked,
         count(*) filter (where public._ae_bot_bucket(user_agent) = 'unknown')::bigint as unknown
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
    and event_name in ('page_view', 'bot_hit')
    and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  group by 1 order by 1;
$$;

-- ── Breakdowns ────────────────────────────────────────────────────────────
-- p_dim:
--   'bot_name'        — allowlisted crawlers by name (bucket 'bot')
--   'blocked_pattern' — blocked junk by matched signature (bucket 'blocked')
--   'country'         — non-human (bot+blocked+unknown) pageviews by country,
--                       so crawl-wave geos (CN/HK/SG, Oct 7-8) stand out
create or replace function public.ae_bot_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit int, p_surface text default 'all')
returns table(value text, bucket text, pageviews bigint, sessions bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.value, v.bucket, count(*)::bigint as pageviews, count(distinct v.session_id)::bigint as sessions
  from (
    select
      case
        when p_dim = 'bot_name'        then public._ae_bot_name(user_agent)
        when p_dim = 'blocked_pattern' then public._ae_blocked_pattern(user_agent)
        when p_dim = 'country'         then coalesce(nullif(country, ''), 'unknown')
        else '(none)'
      end as value,
      case
        when p_dim = 'country' then 'nonhuman'
        else public._ae_bot_bucket(user_agent)
      end as bucket,
      session_id
    from public.analytics_events
    where public.is_giveaway_admin()
      and created_at >= p_from and created_at < p_to
      and event_name in ('page_view', 'bot_hit')
      and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
      and (
        (p_dim = 'bot_name'        and public._ae_bot_bucket(user_agent) = 'bot') or
        (p_dim = 'blocked_pattern' and public._ae_bot_bucket(user_agent) = 'blocked') or
        (p_dim = 'country'         and public._ae_bot_bucket(user_agent) <> 'human')
      )
  ) v
  group by 1, 2 order by pageviews desc
  limit coalesce(p_limit, 15);
$$;

grant execute on function
  public.ae_bot_kpis(timestamptz, timestamptz, text),
  public.ae_bot_timeseries(timestamptz, timestamptz, text, text),
  public.ae_bot_breakdown(text, timestamptz, timestamptz, int, text),
  public._ae_bot_bucket(text),
  public._ae_bot_name(text),
  public._ae_blocked_pattern(text)
  to anon, authenticated, service_role;
