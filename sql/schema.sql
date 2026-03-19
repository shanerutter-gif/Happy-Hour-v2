-- ═══════════════════════════════════════════════════════
-- SPOTD — Full Schema (drop & recreate, safe to rerun)
-- ═══════════════════════════════════════════════════════

-- Drop policies
drop policy if exists "Profiles are public"            on public.profiles;
drop policy if exists "Users can insert own profile"   on public.profiles;
drop policy if exists "Users can update own profile"   on public.profiles;
drop policy if exists "Reviews are public"             on public.reviews;
drop policy if exists "Anyone can post a review"       on public.reviews;
drop policy if exists "Users can update own reviews"   on public.reviews;
drop policy if exists "Users can delete own reviews"   on public.reviews;
drop policy if exists "Users see own favorites"        on public.favorites;
drop policy if exists "Users manage own favorites"     on public.favorites;
drop policy if exists "Users see own follows"          on public.neighborhood_follows;
drop policy if exists "Users manage own follows"       on public.neighborhood_follows;
drop policy if exists "Users see own tokens"           on public.push_tokens;
drop policy if exists "Users manage own tokens"        on public.push_tokens;
drop policy if exists "Venues are public"              on public.venues;
drop policy if exists "Events are public"              on public.events;
drop policy if exists "Cities are public"              on public.cities;

-- Drop triggers
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists reviews_updated_at   on public.reviews;
drop trigger if exists profiles_updated_at  on public.profiles;

-- Drop functions
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

-- Drop tables
drop table if exists public.push_tokens;
drop table if exists public.neighborhood_follows;
drop table if exists public.favorites;
drop table if exists public.reviews;
drop table if exists public.events;
drop table if exists public.venues;
drop table if exists public.cities;
drop table if exists public.profiles;

-- ── EXTENSIONS ────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── CITIES ────────────────────────────────────────────
create table public.cities (
  id           uuid default uuid_generate_v4() primary key,
  slug         text not null unique,
  name         text not null,
  state_code   text not null,
  venue_count  integer default 0,
  event_count  integer default 0,
  active       boolean default false,
  created_at   timestamptz default now()
);

insert into public.cities (slug, name, state_code, active) values
  ('san-diego',     'San Diego',     'CA', true),
  ('los-angeles',   'Los Angeles',   'CA', false),
  ('new-york',      'New York',      'NY', false),
  ('chicago',       'Chicago',       'IL', false),
  ('austin',        'Austin',        'TX', false),
  ('miami',         'Miami',         'FL', false),
  ('orange-county', 'Orange County', 'CA', false);

-- ── PROFILES ──────────────────────────────────────────
create table public.profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  display_name    text,
  digest_enabled  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── VENUES ────────────────────────────────────────────
create table public.venues (
  id            uuid default uuid_generate_v4() primary key,
  city_slug     text not null references public.cities(slug),
  name          text not null,
  neighborhood  text,
  address       text,
  lat           numeric(10,7),
  lng           numeric(10,7),
  hours         text,
  days          text[] default '{}',
  cuisine       text,
  deals         text[] default '{}',
  url           text,
  active        boolean default true,
  featured      boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index venues_city_idx  on public.venues(city_slug);
create index venues_hood_idx  on public.venues(neighborhood);

-- ── EVENTS ────────────────────────────────────────────
create table public.events (
  id            uuid default uuid_generate_v4() primary key,
  city_slug     text not null references public.cities(slug),
  name          text not null,
  event_type    text not null, -- Trivia, Live Music, Karaoke, Bingo, Game Night, Comedy
  venue_name    text,
  neighborhood  text,
  address       text,
  lat           numeric(10,7),
  lng           numeric(10,7),
  hours         text,
  days          text[] default '{}',
  description   text,
  price         text,
  url           text,
  active        boolean default true,
  featured      boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index events_city_idx  on public.events(city_slug);
create index events_type_idx  on public.events(event_type);

-- ── REVIEWS ───────────────────────────────────────────
create table public.reviews (
  id          uuid default uuid_generate_v4() primary key,
  venue_id    uuid references public.venues(id) on delete cascade,
  event_id    uuid references public.events(id) on delete cascade,
  user_id     uuid references auth.users(id)    on delete set null,
  name        text,
  rating      integer not null check (rating between 1 and 5),
  text        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (venue_id is not null or event_id is not null)
);
create index reviews_venue_idx on public.reviews(venue_id);
create index reviews_event_idx on public.reviews(event_id);
create index reviews_user_idx  on public.reviews(user_id);

-- ── FAVORITES ─────────────────────────────────────────
create table public.favorites (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  item_id     text not null,   -- venue or event UUID as text
  item_type   text not null default 'venue',
  created_at  timestamptz not null default now(),
  unique(user_id, item_id)
);
create index favorites_user_idx on public.favorites(user_id);

-- ── NEIGHBORHOOD FOLLOWS ──────────────────────────────
create table public.neighborhood_follows (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  neighborhood  text not null,
  created_at    timestamptz not null default now(),
  unique(user_id, neighborhood)
);

-- ── PUSH TOKENS ─────────────────────────────────────
create table public.push_tokens (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  token       text not null,
  platform    text not null default 'web',  -- 'web', 'ios', 'android'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(user_id, platform)
);
create index push_tokens_user_idx on public.push_tokens(user_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────
alter table public.profiles             enable row level security;
alter table public.venues               enable row level security;
alter table public.events               enable row level security;
alter table public.cities               enable row level security;
alter table public.reviews              enable row level security;
alter table public.favorites            enable row level security;
alter table public.neighborhood_follows enable row level security;
alter table public.push_tokens             enable row level security;

create policy "Cities are public"              on public.cities   for select using (true);
create policy "Venues are public"              on public.venues   for select using (true);
create policy "Events are public"              on public.events   for select using (true);
create policy "Profiles are public"            on public.profiles for select using (true);
create policy "Users can insert own profile"   on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"   on public.profiles for update using (auth.uid() = id);
create policy "Reviews are public"             on public.reviews  for select using (true);
create policy "Anyone can post a review"       on public.reviews  for insert with check (true);
create policy "Users can update own reviews"   on public.reviews  for update using (auth.uid() = user_id);
create policy "Users can delete own reviews"   on public.reviews  for delete using (auth.uid() = user_id);
create policy "Users see own favorites"        on public.favorites for select using (auth.uid() = user_id);
create policy "Users manage own favorites"     on public.favorites for all   using (auth.uid() = user_id);
create policy "Users see own follows"          on public.neighborhood_follows for select using (auth.uid() = user_id);
create policy "Users manage own follows"       on public.neighborhood_follows for all    using (auth.uid() = user_id);
create policy "Users see own tokens"           on public.push_tokens for select using (auth.uid() = user_id);
create policy "Users manage own tokens"        on public.push_tokens for all   using (auth.uid() = user_id);

-- ── TRIGGERS ──────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger reviews_updated_at  before update on public.reviews  for each row execute procedure public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
