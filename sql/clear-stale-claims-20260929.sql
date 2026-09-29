-- ═══════════════════════════════════════════════════════════════════
-- STAGED — NOT APPLIED. Run in the Supabase dashboard SQL editor.
--
-- CEO decision 2026-09-29 (overrides earlier plan): ALL stale business
-- requests are outdated. Do NOT send verification emails.
--   • APPROVE: Altair (Shane's own test claim, shanerutter@gmail.com)
--   • REJECT: Long Story, Seasons 52, Yannis, Topsail, Pillbox Tavern,
--             Nason's Beer Hall — "Cleared per CEO 2026-09-29 — stale/outdated"
--   • NOT TOUCHED: Crackheads (stays rejected, marked Test)
--
-- These rows live in public.venue_requests (the funnel "All Business
-- Requests" table). Rows are matched by claimant email + venue name + pending
-- status, so only the intended rows can change.
--
-- HOW TO RUN:
--   1. Run section 0 (preview) first and confirm exactly 7 rows.
--   2. Run sections 1 and 2.
--   3. Run section 3 to verify the final state.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. PREVIEW — must return exactly 7 rows before you proceed ─────────────
SELECT id, venue_name, user_email, city_slug, status, created_at,
       EXTRACT(DAY FROM now() - created_at)::int AS days_old
FROM public.venue_requests
WHERE status = 'pending'
  AND (
    (user_email = 'shanerutter@gmail.com' AND venue_name ILIKE '%altair%')
    OR (user_email = 'q85v88n4nm@privaterelay.appleid.com' AND venue_name ILIKE '%long story%')
    OR (user_email = '2km887jxxy@privaterelay.appleid.com' AND venue_name ILIKE '%seasons 52%')
    OR (user_email = '2km887jxxy@privaterelay.appleid.com' AND venue_name ILIKE '%yanni%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%topsail%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%pillbox%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%nason%')
  )
ORDER BY created_at;

-- ── 1. APPROVE Shane's own Altair test claim ────────────────────────────────
-- No new venue is created here (Altair already exists as a real venue).
-- If a venue link is wanted, set venue_id on this row in the admin portal.
UPDATE public.venue_requests
SET status = 'approved',
    reviewed_at = now(),
    reason = nullif(
      btrim(coalesce(reason, '') || E'\n[Approved 2026-09-29] Shane''s own test claim — approved per CEO.'),
      ''
    )
WHERE status = 'pending'
  AND user_email = 'shanerutter@gmail.com'
  AND venue_name ILIKE '%altair%';

-- ── 2. REJECT the 6 stale claims ────────────────────────────────────────────
UPDATE public.venue_requests
SET status = 'rejected',
    reviewed_at = now(),
    reason = nullif(
      btrim(coalesce(reason, '') || E'\n[Rejected 2026-09-29] Cleared per CEO 2026-09-29 — stale/outdated ('
        || EXTRACT(DAY FROM now() - created_at)::int || ' days old).'),
      ''
    )
WHERE status = 'pending'
  AND (
    (user_email = 'q85v88n4nm@privaterelay.appleid.com' AND venue_name ILIKE '%long story%')
    OR (user_email = '2km887jxxy@privaterelay.appleid.com' AND venue_name ILIKE '%seasons 52%')
    OR (user_email = '2km887jxxy@privaterelay.appleid.com' AND venue_name ILIKE '%yanni%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%topsail%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%pillbox%')
    OR (user_email = 'leximorrison00@gmail.com' AND venue_name ILIKE '%nason%')
  );

-- ── 3. VERIFY — expect 1 approved (Altair) + 6 rejected, 0 pending ──────────
SELECT venue_name, user_email, status, reviewed_at
FROM public.venue_requests
WHERE user_email IN (
    'shanerutter@gmail.com',
    'q85v88n4nm@privaterelay.appleid.com',
    '2km887jxxy@privaterelay.appleid.com',
    'leximorrison00@gmail.com'
  )
  AND reviewed_at >= now() - interval '1 hour'
ORDER BY status, venue_name;
