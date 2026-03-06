-- ═══════════════════════════════════════════════════════
-- SD HAPPY HOUR — SUPABASE SCHEMA
-- Run this in: supabase.com → Your Project → SQL Editor
-- ═══════════════════════════════════════════════════════

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── PROFILES ─────────────────────────────────────────────
-- Extends auth.users with display name, digest opt-in, etc.
create table if not exists public.profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  display_name    text,
  avatar_url      text,
  digest_enabled  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── REVIEWS ──────────────────────────────────────────────
create table if not exists public.reviews (
  id          uuid default uuid_generate_v4() primary key,
  venue_id    integer not null,
  user_id     uuid references auth.users(id) on delete set null,
  name        text,
  rating      integer not null check (rating between 1 and 5),
  text        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reviews_venue_id_idx on public.reviews(venue_id);
create index if not exists reviews_user_id_idx  on public.reviews(user_id);

-- ── FAVORITES ─────────────────────────────────────────────
create table if not exists public.favorites (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  venue_id    integer not null,
  created_at  timestamptz not null default now(),
  unique(user_id, venue_id)
);
create index if not exists favorites_user_id_idx on public.favorites(user_id);

-- ── NEIGHBORHOOD FOLLOWS ──────────────────────────────────
create table if not exists public.neighborhood_follows (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  neighborhood  text not null,
  created_at    timestamptz not null default now(),
  unique(user_id, neighborhood)
);
create index if not exists hood_follows_user_idx on public.neighborhood_follows(user_id);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════

alter table public.profiles           enable row level security;
alter table public.reviews            enable row level security;
alter table public.favorites          enable row level security;
alter table public.neighborhood_follows enable row level security;

-- Profiles: public read, self write
create policy "Profiles are public"
  on public.profiles for select using (true);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Reviews: public read, authed insert, self delete/update
create policy "Reviews are public"
  on public.reviews for select using (true);
create policy "Anyone can post a review"
  on public.reviews for insert with check (true);
create policy "Users can update own reviews"
  on public.reviews for update using (auth.uid() = user_id);
create policy "Users can delete own reviews"
  on public.reviews for delete using (auth.uid() = user_id);

-- Favorites: private per user
create policy "Users see own favorites"
  on public.favorites for select using (auth.uid() = user_id);
create policy "Users manage own favorites"
  on public.favorites for all using (auth.uid() = user_id);

-- Neighborhood follows: private per user
create policy "Users see own follows"
  on public.neighborhood_follows for select using (auth.uid() = user_id);
create policy "Users manage own follows"
  on public.neighborhood_follows for all using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at on reviews
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reviews_updated_at
  before update on public.reviews
  for each row execute procedure public.set_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
