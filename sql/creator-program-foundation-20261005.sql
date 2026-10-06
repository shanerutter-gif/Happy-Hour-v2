-- Creator Program foundation (Spotd-side only).
-- Run ONCE in the Supabase SQL editor. NOT applied by automation; safe to
-- re-run (all idempotent). Do NOT run against live until reviewed.
--
-- Covers spec sections 2-6 (tiers, eligibility support, badge model,
-- auto-follow mechanics, cross-posting tables):
--   1. profiles: is_creator / creator_tier / creator_since (badge model, §4)
--   2. user_follows: source column + unique pair (auto-follow dedup, §5)
--   3. creator_connections: encrypted OAuth tokens (sync seam, §6)
--   4. feed_items: cross-posted creator content (sync seam, §6)
--   5. Auto-follow trigger: on profile creation, follow all active creators
--      (founding tier first), source='creator_auto_follow', on conflict do
--      nothing (idempotent). Scaling guard: caps at 20 when >50 creators.
--
-- OUT OF SCOPE (seams left for the OAuth/sync build): token encryption is the
-- sync job's responsibility (columns are text); no poller is created here.

-- ── 1. profiles: creator flags ──────────────────────────────────────────
alter table public.profiles
  add column if not exists is_creator    boolean not null default false,
  add column if not exists creator_tier  text,
  add column if not exists creator_since timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_creator_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_creator_tier_check
      check (creator_tier is null or creator_tier in ('founding', 'verified'));
  end if;
end $$;

create index if not exists profiles_is_creator_idx
  on public.profiles (is_creator) where is_creator = true;

-- ── 2. user_follows: source column + dedup ──────────────────────────────
-- NOTE: user_follows was created outside the repo migrations (live DB only),
-- so this is defensive: create-if-missing, then add-if-missing per column.
create table if not exists public.user_follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  source       text not null default 'manual',
  created_at   timestamptz not null default now()
);

alter table public.user_follows
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_follows_pair_unique'
  ) then
    alter table public.user_follows
      add constraint user_follows_pair_unique unique (follower_id, following_id);
  end if;
end $$;

create index if not exists user_follows_follower_idx on public.user_follows (follower_id);
create index if not exists user_follows_following_idx on public.user_follows (following_id);

alter table public.user_follows enable row level security;

drop policy if exists "Users see own follows"    on public.user_follows;
drop policy if exists "Users manage own follows" on public.user_follows;
drop policy if exists "Service role full access" on public.user_follows;

create policy "Users see own follows"
  on public.user_follows for select using (auth.uid() = follower_id);
create policy "Users manage own follows"
  on public.user_follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);
-- Service-role bypasses RLS; explicit policy documents the server-side writers
-- (auto-follow trigger, admin tooling).
create policy "Service role full access"
  on public.user_follows for all using (true) with check (true);

-- ── 3. creator_connections: OAuth token store (sync seam) ───────────────
create table if not exists public.creator_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  platform          text not null check (platform in ('tiktok', 'instagram')),
  platform_user_id  text not null,
  access_token_enc  text,
  refresh_token_enc text,
  token_expires_at  timestamptz,
  scopes            text,
  status            text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, platform)
);

create index if not exists creator_connections_user_idx   on public.creator_connections (user_id);
create index if not exists creator_connections_status_idx on public.creator_connections (status) where status = 'active';

alter table public.creator_connections enable row level security;

-- Tokens must NEVER be publicly readable. Only the service role (sync job,
-- OAuth callbacks) touches this table. No anon/authenticated policies.
drop policy if exists "Service role full access" on public.creator_connections;
create policy "Service role full access"
  on public.creator_connections for all using (true) with check (true);

-- ── 4. feed_items: cross-posted creator content (sync seam) ──────────────
create table if not exists public.feed_items (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.profiles(id) on delete cascade,
  platform          text not null check (platform in ('tiktok', 'instagram')),
  platform_media_id text not null,
  caption           text,
  thumbnail_url     text,
  permalink         text,
  embed_html        text,
  posted_at         timestamptz,
  like_count        integer not null default 0,
  comment_count     integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (platform, platform_media_id)
);

create index if not exists feed_items_creator_idx on public.feed_items (creator_id);
create index if not exists feed_items_posted_idx  on public.feed_items (posted_at desc);

alter table public.feed_items enable row level security;

-- Cross-posted items are public content (creator-consented). Public read;
-- writes are service-role only (the sync poller).
drop policy if exists "Public read" on public.feed_items;
drop policy if exists "Service role full access" on public.feed_items;
create policy "Public read"
  on public.feed_items for select using (true);
create policy "Service role full access"
  on public.feed_items for all using (true) with check (true);

-- ── 5. Auto-follow trigger (§5) ──────────────────────────────────────────
-- On profile creation, the new user follows every active creator
-- (is_creator = true), founding tier first. Idempotent via the unique
-- (follower_id, following_id) constraint + ON CONFLICT DO NOTHING, so
-- retries and backfills never create dupes.
-- Scaling guard (spec §5): when the roster exceeds 50 creators, only the
-- top 20 are auto-followed (founding tier first, then earliest joined).
-- City-relevance ordering is applied at display time (creator directory /
-- follow card); the trigger runs before the user's city is known.
create or replace function public.auto_follow_creators()
returns trigger language plpgsql security definer as $$
declare
  v_total integer;
  v_cap   integer;
begin
  select count(*) into v_total from public.profiles where is_creator = true;
  if v_total = 0 then
    return new;
  end if;
  v_cap := case when v_total > 50 then 20 else v_total end;

  insert into public.user_follows (follower_id, following_id, source)
  select new.id, p.id, 'creator_auto_follow'
    from public.profiles p
   where p.is_creator = true
     and p.id <> new.id
   order by case when p.creator_tier = 'founding' then 0 else 1 end,
            p.creator_since nulls last,
            p.created_at
   limit v_cap
  on conflict (follower_id, following_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_profile_created_auto_follow_creators on public.profiles;
create trigger on_profile_created_auto_follow_creators
  after insert on public.profiles
  for each row execute procedure public.auto_follow_creators();
