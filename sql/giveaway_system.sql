-- ════════════════════════════════════════════════════════════════════
-- Spotd — Weekly Giveaway + Referral System
-- Migration: 2026_04_28_giveaway_system
-- Adapted to the existing Spotd schema:
--   * check_ins already exists (user_id, venue_id, city_slug, date, note, created_at)
--     — we add a unique index for 1/venue/day and trigger on insert.
--   * reviews already exists (user_id, venue_id, event_id, ...)
--   * "social posts" map to checkin_photos (the photo/video posts users
--     create in the social section).
--   * profiles already exists; we add referred_by.
-- Safe to rerun (uses IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT).
-- ════════════════════════════════════════════════════════════════════

-- 1. REFERRAL CODES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code       text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);

-- 2. REFERRALS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_id         uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code_used text NOT NULL,
  signed_up_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_referral CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- 3. CHECK-INS — already exists; add 1-per-venue-per-day unique index ─
-- The existing table uses a separate `date` column, which we reuse.
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_ins_unique_per_day
  ON public.check_ins(user_id, venue_id, date);

-- 4. GIVEAWAY ENTRIES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start        date NOT NULL,
  entry_type        text NOT NULL CHECK (entry_type IN ('self','referral_bonus')),
  source_referee_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_bonus_has_referee CHECK (
    (entry_type = 'self' AND source_referee_id IS NULL) OR
    (entry_type = 'referral_bonus' AND source_referee_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_giveaway_entries_self
  ON public.giveaway_entries(user_id, week_start)
  WHERE entry_type = 'self';

CREATE UNIQUE INDEX IF NOT EXISTS idx_giveaway_entries_referral
  ON public.giveaway_entries(user_id, week_start, source_referee_id)
  WHERE entry_type = 'referral_bonus';

CREATE INDEX IF NOT EXISTS idx_giveaway_entries_week
  ON public.giveaway_entries(week_start);

-- 5. GIVEAWAY WINNERS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.giveaway_winners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start         date NOT NULL UNIQUE,
  winner_user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  total_entries      int NOT NULL,
  winner_entry_count int NOT NULL,
  prize_status       text NOT NULL DEFAULT 'pending'
                     CHECK (prize_status IN ('pending','sent','delivered')),
  prize_notes        text,
  picked_at          timestamptz NOT NULL DEFAULT now()
);

-- 6. PROFILES — add referred_by ─────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════
-- HELPERS
-- ════════════════════════════════════════════════════════════════════

-- ISO week start (Monday) in America/Los_Angeles
CREATE OR REPLACE FUNCTION public.current_week_start_pt()
RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles'))::date;
$$;

-- ISO week start for an arbitrary timestamptz, expressed in PT
CREATE OR REPLACE FUNCTION public.week_start_pt_for(ts timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT date_trunc('week', (ts AT TIME ZONE 'America/Los_Angeles'))::date;
$$;

-- Generate a unique 6-char referral code (no 0/O/1/I)
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
  attempts int := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = result) THEN
      RETURN result;
    END IF;
    attempts := attempts + 1;
    IF attempts > 50 THEN
      RAISE EXCEPTION 'Could not generate unique referral code after 50 attempts';
    END IF;
  END LOOP;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- TRIGGER: auto-create referral code when a profile is created
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_referral_code_for_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.referral_codes (user_id, code)
  VALUES (NEW.id, public.generate_referral_code())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_referral_code ON public.profiles;
CREATE TRIGGER trg_create_referral_code
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_referral_code_for_profile();

-- Backfill existing profiles
INSERT INTO public.referral_codes (user_id, code)
SELECT p.id, public.generate_referral_code()
FROM public.profiles p
LEFT JOIN public.referral_codes rc ON rc.user_id = p.id
WHERE rc.user_id IS NULL
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- CORE FUNCTION: grant entries for a qualifying action
-- Called from triggers on check_ins, reviews, checkin_photos.
-- p_action_at lets backfilled rows land in the correct ISO week.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.grant_giveaway_entries(
  p_user_id   uuid,
  p_action_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_week_start  date := public.week_start_pt_for(p_action_at);
  v_referrer_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- Self entry (idempotent via partial unique index)
  INSERT INTO public.giveaway_entries (user_id, week_start, entry_type, source_referee_id)
  VALUES (p_user_id, v_week_start, 'self', NULL)
  ON CONFLICT DO NOTHING;

  -- Referrer bonus (idempotent per week per referee)
  SELECT referrer_id INTO v_referrer_id
  FROM public.referrals
  WHERE referee_id = p_user_id;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.giveaway_entries (user_id, week_start, entry_type, source_referee_id)
    VALUES (v_referrer_id, v_week_start, 'referral_bonus', p_user_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- TRIGGERS on the three qualifying actions
-- ════════════════════════════════════════════════════════════════════

-- Check-ins
CREATE OR REPLACE FUNCTION public.trg_checkin_grant_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.grant_giveaway_entries(NEW.user_id, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checkin_giveaway ON public.check_ins;
CREATE TRIGGER trg_checkin_giveaway
  AFTER INSERT ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.trg_checkin_grant_entry();

-- Reviews
CREATE OR REPLACE FUNCTION public.trg_review_grant_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.grant_giveaway_entries(NEW.user_id, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_giveaway ON public.reviews;
CREATE TRIGGER trg_review_giveaway
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_review_grant_entry();

-- Social posts == checkin_photos (photo/video posts in the social section)
CREATE OR REPLACE FUNCTION public.trg_social_post_grant_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.grant_giveaway_entries(NEW.user_id, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_social_post_giveaway ON public.checkin_photos;
CREATE TRIGGER trg_social_post_giveaway
  AFTER INSERT ON public.checkin_photos
  FOR EACH ROW EXECUTE FUNCTION public.trg_social_post_grant_entry();

-- ════════════════════════════════════════════════════════════════════
-- ADMIN RPC: top referrers (last 30 days)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.top_referrers_30d()
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  email            text,
  code             text,
  total_referred   bigint,
  active_this_week bigint
)
LANGUAGE sql SECURITY DEFINER
AS $$
  WITH thirty AS (
    SELECT referrer_id, count(*)::bigint AS total
    FROM public.referrals
    WHERE signed_up_at >= now() - interval '30 days'
    GROUP BY referrer_id
  ),
  active AS (
    SELECT user_id, count(*)::bigint AS active
    FROM public.giveaway_entries
    WHERE entry_type = 'referral_bonus'
      AND week_start = public.current_week_start_pt()
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.display_name,
    au.email::text,
    rc.code,
    COALESCE(t.total, 0),
    COALESCE(a.active, 0)
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  JOIN public.referral_codes rc ON rc.user_id = p.id
  LEFT JOIN thirty t ON t.referrer_id = p.id
  LEFT JOIN active a ON a.user_id = p.id
  WHERE COALESCE(t.total, 0) > 0
  ORDER BY COALESCE(t.total, 0) DESC, COALESCE(a.active, 0) DESC
  LIMIT 25;
$$;

-- ════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_winners  ENABLE ROW LEVEL SECURITY;

-- referral_codes: anyone can look up by code (needed for signup), users see their own row
DROP POLICY IF EXISTS "lookup code on signup"        ON public.referral_codes;
CREATE POLICY  "lookup code on signup"
  ON public.referral_codes FOR SELECT USING (true);

-- referrals: users see referrals where they are referrer or referee; insert only as the referee
DROP POLICY IF EXISTS "users read own referrals"     ON public.referrals;
CREATE POLICY  "users read own referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

DROP POLICY IF EXISTS "users insert own referral"    ON public.referrals;
CREATE POLICY  "users insert own referral"
  ON public.referrals FOR INSERT
  WITH CHECK (auth.uid() = referee_id);

-- giveaway_entries: users read their own entries
DROP POLICY IF EXISTS "users read own entries"       ON public.giveaway_entries;
CREATE POLICY  "users read own entries"
  ON public.giveaway_entries FOR SELECT
  USING (auth.uid() = user_id);

-- giveaway_winners: public read so the app can show last week's winner
DROP POLICY IF EXISTS "winners public read"          ON public.giveaway_winners;
CREATE POLICY  "winners public read"
  ON public.giveaway_winners FOR SELECT USING (true);
