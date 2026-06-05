# CLAUDE.md — spotd context bible

This file is the source of truth for every Claude Code session on spotd.
**Read it fully before doing anything.** If something here is wrong or out of date,
fix it as part of your turn — see the meta rule below.

---

## ⚠️ META RULE — keep this file alive

**Before ending any turn, ask yourself two questions:**

1. Did I make a code change that introduces a new pattern, vendor, table, env var,
   feature, endpoint, admin tab, file convention, or architectural decision?
   → If yes, **edit the relevant section of this file** before stopping.
2. Did we discuss an idea (mine or the user's) that we didn't ship?
   → If yes, **append it to the "Ideas / backlog" section** before stopping.

A `.claude/hooks/stop-claude-md-check.sh` Stop hook enforces this — if files
changed this turn and CLAUDE.md didn't, the turn won't end. If a change is
genuinely too trivial to document (typo fix, one-line tweak), update CLAUDE.md
anyway with a one-line note under "Recent decisions" explaining why, and stop.

**The point: future Claude sessions should never have to ask "what already exists?"
or "which vendor do we use?" — the answer should be in this file.**

---

## What is spotd

A happy-hour / venue discovery PWA + iOS app. Find today's deals, trivia nights,
live music, events near you. UK-focused founder but venue data covers multiple
US cities too (San Diego is the active launch market). Live at `spotd.biz` and
as a native iOS app (bundle ID `biz.spotd.app`, App Store ID `6760452388`).

User: Shane Rutter (`shanerutter@gmail.com`) — solo founder, primary developer,
sole admin. UK-based.

---

## What's live (production)

**The vanilla JS app at the repo root is what ships to `spotd.biz`.**

- No build step. Files served as static from the repo root by Vercel.
- `api/*.js` runs as Vercel **edge functions** (`export const config = { runtime: 'edge' }`).
- iOS app is a WKWebView wrapping the same web app — UA-sniff for native-only behaviors.
- The previous React rewrite at `spotd-app/` was **deleted in commit `6b2d50d`**.
  Do NOT recreate it. Do NOT introduce React / Next / Vue / Svelte / any framework.

### Vercel project
- Project name: `happy-hour-v2`, team `shanerutter-2028s-projects`.
- Production domains: `spotd.biz`, `www.spotd.biz`.
- **Canonical host is `https://www.spotd.biz`.** The apex (`spotd.biz`) 301/307s to
  www, so **every canonical / `og:url` / JSON-LD URL / sitemap `<loc>` / internal
  absolute link MUST use `www`** — pointing at the apex makes Google label pages
  "Alternate page with proper canonical tag" and skip indexing. Edge renderers
  (`api/spots.js`, `api/blog-post.js`, `api/sitemap-venues.js`) each define a
  `const SITE_URL = 'https://www.spotd.biz'` — use it. Never hardcode the apex.
- `main` auto-deploys to production.

### Development branch convention
`claude/<description>-<random-suffix>` (e.g. `claude/giveaway-referral-system-UqObA`).
PR style: sentence-case imperative title, optional `namespace:` prefix
(e.g. "Email Builder: save / load / delete templates"), body has `## Summary` +
`## Test plan` checklist + trailing Claude session URL.

---

## Vendors (DEFINITIVE — never propose alternatives)

| Concern        | Vendor / lib              | Where wired                                          |
|----------------|---------------------------|------------------------------------------------------|
| Hosting        | Vercel                    | `vercel.json`                                        |
| DB + Auth + Storage | Supabase (`opcskuzbdfrlnyhraysk`) | direct REST + `@supabase/supabase-js@2` (admin only) |
| Email (all of it) | **Loops**              | `api/loops-*.js`, `api/daily-deals.js`, `emails/*`   |
| Payments       | Stripe (B2B subs)         | `api/stripe-*.js`                                    |
| iOS push       | APNs (ES256 JWT inline)   | `api/send-push.js`                                   |
| Web push       | VAPID (currently inert — keypair mismatch) | `api/send-push.js:114` short-circuits `platform === 'web'` |
| Venue data enrichment | Google Places       | `api/admin-enrich-venues.js`                         |
| Maps           | Leaflet 1.9.4 + markercluster 1.5.3 | unpkg CDN in `index.html`                  |
| Analytics      | GA4 (`G-9PXGE6LEPE`)      | `track()` helper in `js/db.js:25`                    |
| Fonts          | Google Fonts (Cabinet Grotesk + DM Sans + DM Mono) | `index.html` |

**Email is Loops. Period.** Never propose Resend, SendGrid, Mailgun, Postmark,
AWS SES. Loops is wired for: contact creation, event-triggered campaigns,
transactional templates, onboarding drip, daily deals. The Email Builder admin
tab exports MJML zips formatted for Loops upload.

---

## Hard rules

### Always
1. **Edit the vanilla JS app at repo root.** No frameworks, no build step.
2. **Use Loops for all email.** Client side: fire-and-forget via `POST /api/loops-event`.
   Server side: `POST https://app.loops.so/api/v1/events/send`.
3. **New API routes use Vercel Edge runtime.** First line:
   `export const config = { runtime: 'edge' };`. Exception: `api/run-migration.js`
   uses Node because it needs `pg`.
4. **Use raw `fetch()` + Web Crypto** for everything (Supabase REST, Stripe API,
   Stripe webhook signature, APNs JWT, VAPID). No SDKs in edge functions.
5. **For cron routes, accept BOTH auth methods:** `Authorization: Bearer ${CRON_SECRET}`
   (Vercel Cron) AND `?key=<SUPABASE_SERVICE_ROLE_KEY>` (manual trigger).
   Pattern: `api/loops-inactive.js:17-20`.
6. **For new admin tools, extend the existing admin portal** — see "Admin portal"
   section. Add a self-contained JS file at repo root (kebab-case), append it to
   `SCRIPT_TAGS` in `api/admin-page.js`, follow the `inject()` IIFE pattern.
7. **For project / TODO / kanban work, extend `board_cards` table + `admin/board.html`.**
   It already exists with 5 tabs and full DnD — do NOT build a parallel system.
8. **Server-side admin gating:** use `public.is_giveaway_admin()` Postgres RPC OR
   the hardcoded `ADMIN_EMAILS = {'shanerutter@gmail.com'}` allow-list. Pattern:
   `api/admin-enrich-venues.js:63-76`.
9. **Cache busting:** bump the `?v=YYYYMMDD<letter>` query string on changed
   JS/CSS imports in `index.html` (precedent: PR #151).
10. **CORS on all API routes:** `Access-Control-Allow-Origin: *` + methods + headers,
    handle `OPTIONS` preflight returning 200. See `api/loops-event.js:50-56`.
11. **Use `track()` helper from `js/db.js:25` for GA4 events** — never call `gtag()` directly.
12. **Commit style:** sentence-case imperative, optional `namespace:` prefix.
    PR body: `## Summary` (1-3 bullets) + `## Test plan` (checkboxes) + Claude session URL.

### Never
1. Never propose Resend / SendGrid / Mailgun / Postmark / SES / any non-Loops email vendor.
2. Never recreate `spotd-app/` or introduce a frontend framework.
3. Never expose `LOOPS_API_KEY`, `SUPABASE_SERVICE_KEY`, or `STRIPE_SECRET_KEY` to the browser.
4. Never enable web push without first replacing the hardcoded `VAPID_PUBLIC_KEY` in
   `api/send-push.js:4` and verifying the keypair matches.
5. Never add a Node-runtime dependency to `package.json` unless edge runtime
   genuinely cannot do the job (currently only `pg`).
6. Never call a vendor SDK from an edge function. Raw HTTPS only.
7. Never assume the admin portal lacks a feature — check the sidebar nav
   inventory below and the four extension scripts first.
8. Never push to `main` directly. Never `git push --force` to `main`. Never
   `--no-verify` on commits.

---

## Admin portal — feature inventory

**`admin.html` is a 385KB SPA** served by `api/admin-page.js`, which fetches the
HTML from the GitHub Contents API (`?ref=main`) and **injects 4 extension
scripts before `</body>`** at serve time. To add a new admin tool:

1. Create `admin-<feature>.js` at repo root (kebab-case).
2. Append it to `SCRIPT_TAGS` in `api/admin-page.js`.
3. Inside the file, use the `inject()` IIFE pattern: append a sidebar nav item
   (desktop), a mobile drawer item, and a `<div class="page" id="page-<feature>">`.
4. Mirror JWT refresh + auth from `admin-giveaway.js` / `admin-attribution.js`.

### Sidebar groups (matches `admin.html:1256-1331`)

| Group         | Nav id              | Page                  | Backed by                                   |
|---------------|---------------------|-----------------------|---------------------------------------------|
| Review Queue  | `nav-requests`      | Venue Requests        | `venue_requests` table                      |
|               | `nav-claims`        | Business Claims       | `venue_claims` (injected by `admin-claims.js`) |
| Listings      | `nav-venues`        | All Venues (inline edit) | `venues` table                           |
|               | `nav-enrichment`    | Venue Enrichment      | `enrichment_runs` + Google Places (injected by `admin-enrichment.js`) |
|               | `nav-heroes`        | Hero Picker           | `venues.featured` flag                      |
| Users         | `nav-users`         | User Analytics (6 KPIs) | `profiles` + `auth.users`                 |
|               | `nav-churn`         | Churned Users         | `profiles.last_seen`                        |
| Insights      | `nav-venues-top`    | Top Venues (check-ins/rating/saves) | `venues` + joins             |
|               | `nav-cities`        | City Breakdown        | `cities` + `venues`                         |
|               | `nav-pipeline`      | Revenue Pipeline      | `crm_contacts.stage`                        |
| CRM           | `nav-crm`           | CRM Dashboard         | `crm_*` tables                              |
|               | `nav-crm-contacts`  | Contacts              | `crm_contacts`                              |
|               | `nav-crm-pipeline`  | Pipeline (kanban)     | `crm_contacts.stage`                        |
|               | `nav-crm-activity`  | Activity Log          | `crm_activities`                            |
| Engage        | `nav-feedback`      | User Feedback         | `feedback` table                            |
|               | `nav-push`          | Push composer + history | `push_tokens` → `/api/send-push`          |
|               | `nav-newsletter`    | Newsletter Subscribers | `newsletter_subscribers`                   |
|               | `nav-giveaway`      | Weekly Giveaway       | `giveaway_*` tables (injected by `admin-giveaway.js`) |
|               | `nav-attribution`   | Signup Attribution    | `signup_attributions` (injected by `admin-attribution.js`) |
| Tools         | `nav-cms`           | Site Copy editor      | `site_copy` table + iframe preview          |
|               | `nav-board`         | **Project Board** (iframe → `/admin/board.html`) | `board_cards` table |
|               | `nav-demo`          | Demo Data Generator   | bulk inserts                                |
|               | `nav-assets`        | Asset Generator       | template-based image gen                    |
|               | `nav-email-builder` | Email Builder (MJML)  | `email_templates` → ZIP for Loops upload    |
|               | `nav-content-calendar` | Content Calendar   | `content_posts` table                       |
|               | `nav-blog`          | Blog Manager (CRUD)   | `blog_posts` table                          |

### Admin auth model
- Session in `localStorage['spotd-admin-session']` as `{ token, refresh_token, expires_at, user }`.
- All scripts use `session()` helper + `Authorization: Bearer <token>` against `${SUPABASE_URL}/rest/v1/...`.
- JWT refresh-on-expiry hits `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`. Mirror this pattern.

---

## Project board — IT ALREADY EXISTS

**Path:** `admin/board.html` (480 lines) — embedded in admin via iframe at
`nav-board`, also reachable at `https://spotd.biz/admin/board.html`.

**Columns:** Backlog → To Do → In Progress → Done → Blocked (icons 📋 📌 🔨 ✅ 🚧).

**5 tabs (board column):** Product / Engineering · Marketing · Sales · Operations · Analytics.
Cards filter by tab; legacy rows with `board IS NULL` fall back to `product`.

**Card fields** (`saveCard()` at `admin/board.html:446-464`):
- `title` (required), `description`
- `col` (backlog/todo/inprogress/done/blocked)
- `type` (feature/bug/chore/idea/design) — color-coded badges
- `priority` (none/low/med/high) — colored left border
- `due_date` (renders "Overdue" / "Today" / "Tomorrow" / date; orange if ≤2 days)
- `assignee` (free text, rendered as 2-char initial avatar)
- `subtasks` (jsonb array `[{text, done}]` with progress bar)
- `position` (sparse int, gaps of 1000, midpoint-insert algorithm)
- `board` (product/marketing/sales/operations/analytics)

**Backing table: `public.board_cards`** — DDL not committed to `sql/` (applied
directly via SQL editor or `api/run-migration.js`). If you need to extend the
schema, write the migration to `sql/` and apply via the admin SQL runner.

**Data access:** uses `@supabase/supabase-js@2` with **service role key hardcoded
in client JS** (`admin/board.html:200`) — pragmatically fine because the page is
admin-gated, but be aware.

**Dashboard widget at `admin.html:7088`** queries the same table for due-soon
non-done tasks ("Due / Upcoming Tasks" card on the admin landing page).

**For any "project / TODO / kanban / task tracker" ask: extend this. Do not build a parallel system.**

---

## API endpoints

All edge runtime unless noted. Routes wired in `vercel.json`'s `routes` array.

### Public / SEO
- `POST /api/auth` — signup/login proxy to Supabase Auth.
- `GET /spots/<slug>` → `api/spots.js` — SSR venue page with JSON-LD (LocalBusiness, AggregateRating, BreadcrumbList, Offer catalog), OG, Twitter Cards. Caches `s-maxage=3600, stale-while-revalidate=86400`.
- `GET /spots` → `api/spots-directory.js` — **crawlable HTML directory** of every indexable venue (active + `photo_url IS NOT NULL`, same set as the sitemap), grouped by city with real `<a href>` links + `ItemList` JSON-LD. This is the discovery entry point that lets Googlebot crawl to all venue pages (they're otherwise only reachable via the JS app). Note: the `/spots` exact route MUST sit before `/spots/(.+)` in `vercel.json`.
- `GET /happy-hour/<city>` and `GET /happy-hour/<city>/<neighborhood-slug>` → `api/happy-hour.js` — **SSR city/neighborhood landing pages** targeting money queries ("happy hour san diego", "downtown san diego happy hours"). Data-driven unique copy (live counts, real venue names/deals), crawlable venue list linking to `/spots/<slug>`, day-filter chips (`?day=tuesday` → explicit-`days[]` matches only, so day pages aren't near-dupes), neighborhood chips, FAQ (visible + `FAQPage` JSON-LD, mirrored), `ItemList` + `BreadcrumbList` JSON-LD. Works for any city with photo'd venues (SD + OC today); 404s otherwise. Day-filtered views self-canonicalize (`?day=` included).
- `GET /sitemap-venues.xml` → `api/sitemap-venues.js` — only venues with `photo_url IS NOT NULL` (photoless venues stay out of Google's index).
- `GET /sitemap-cities.xml` → `api/sitemap-cities.js` — dynamic sitemap for `/spots`, every `/happy-hour/<city>`, each neighborhood page, and the 7 city-level `?day=` pages. Listed in `robots.txt`.

### Admin
- `GET /admin.html` → `api/admin-page.js` — fetches `admin.html` from GitHub Contents API + injects `SCRIPT_TAGS`.
- `GET|POST /api/admin-enrich-venues` — Google Places enrichment. Actions: `preview`, `batch` (5/call), `venue`. Auth: Bearer JWT → `/auth/v1/user` → `ADMIN_EMAILS` allow-list.

### Email (Loops)
- `POST /api/loops-event` — generic event passthrough. Client fire-and-forget pattern in `js/db.js:204-211`.
- `POST /api/loops-onboarding` — `POST /contacts/create` (idempotent, 409 = ok) then event `signup`.
- `GET /api/loops-inactive` (cron) — finds `last_seen` 7-8d or 30-31d ago, sends `inactive_7d` / `inactive_30d`.
- `GET /api/daily-deals` (cron) — picks 3 deal venues rotated by day-of-year, sends `daily_deals` to all Loops contacts (paginated, rate-limited).

### Payments
- `POST /api/stripe-checkout` — creates Stripe customer + Checkout session for `STRIPE_PRO_PRICE_ID` (mode `subscription`). Verifies venue ownership via user JWT + RLS.
- `POST /api/stripe-billing-portal` — Customer Portal session.
- `POST /api/stripe-webhook` — handles `checkout.session.completed`, `customer.subscription.{updated,deleted}`, `invoice.payment_{failed,succeeded}`. HMAC-SHA256 signature verified via Web Crypto.

### Push
- `POST /api/send-push` — APNs ES256 JWT built inline (no SDK). `?diagnose=true` returns JWT header+claims without sending. Web push currently inert (`platform === 'web'` skipped at line 114).
  Auth: `Authorization: Bearer ${PUSH_API_KEY}` (also used by Postgres `pg_net` triggers).

### Admin-only (not routed by name)
- `POST /api/run-migration` — **Node runtime**, uses `pg`. Auth: `Bearer ${SUPABASE_SERVICE_KEY}`. Raw SQL executor.

### Crons (`vercel.json:3-6`)
- `/api/loops-inactive` daily `0 14 * * *` UTC
- `/api/daily-deals` daily `0 14 * * *` UTC

---

## Auth patterns (mimic these)

| Use case                 | Pattern                                                       | Reference                              |
|--------------------------|---------------------------------------------------------------|----------------------------------------|
| User-authenticated admin | Bearer JWT → `/auth/v1/user` → check email in `ADMIN_EMAILS`  | `api/admin-enrich-venues.js:63-76`     |
| Business owner action    | Bearer user JWT → query with that JWT, let RLS enforce        | `api/stripe-checkout.js:36-44`         |
| Cron                     | `Bearer ${CRON_SECRET}` (Vercel) OR `?key=<SERVICE_ROLE_KEY>` | `api/loops-inactive.js:17-20`          |
| Internal triggers (DB → API) | Static `Bearer ${PUSH_API_KEY}`                           | `api/send-push.js:14-19`               |

---

## Email pipeline (Loops)

### Client-side standard
```js
function sendLoopsEvent(eventName, properties) {
  // gets email from current session
  fetch('/api/loops-event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, eventName, properties }),
  }).catch(e => console.warn(`[Loops] Event "${eventName}" failed:`, e.message));
}
```
Fire-and-forget. Never blocks UI. Goes through edge proxy so `LOOPS_API_KEY` stays server-side.

### All Loops events currently sent
| Event                     | Sent from                                            |
|---------------------------|------------------------------------------------------|
| `signup`                  | `api/loops-onboarding.js` (after email or Google OAuth signup) |
| `first_review`            | `js/db.js:497`                                       |
| `first_checkin`           | `js/db.js:598`                                       |
| `checkin_streak`          | `js/db.js:600` (every milestone)                     |
| `first_follow`            | `js/db.js:674`                                       |
| `got_first_follower`      | `js/db.js:684`                                       |
| `post_liked`              | `js/db.js:1523`                                      |
| `venue_request_submitted` | `js/db.js:552` + `business-portal.html:1506`         |
| `venue_claimed`           | `business-portal.html:1558`                          |
| `inactive_7d`             | `api/loops-inactive.js:77`                           |
| `inactive_30d`            | `api/loops-inactive.js:88`                           |
| `daily_deals`             | `api/daily-deals.js:99` (cron)                       |

### Email templates
- `emails/01-welcome.html` through `05-push-notifications.html` — onboarding drip series (Loops handles the actual schedule once `signup` fires).
- `emails/daily-deals.mjml` (source) → `emails/daily-deals.html` (compiled) — transactional template uploaded to Loops keyed to `daily_deals` event.
- Admin **Email Builder** tab generates new MJML templates and exports a ZIP with the inner file named **exactly `index.mjml`** (Loops requirement). Templates persist in `email_templates` table.

---

## Database / Supabase

Project ref: `opcskuzbdfrlnyhraysk` (hardcoded in `js/db.js`, `admin/board.html`, all admin extension scripts, and fallback in cron functions).

### Tables by domain

**Core discovery** (`sql/schema.sql` + drift since)
- `cities` — slug PK, name, state_code, venue_count, event_count, active. Public read. **Not the UI gate** (the `CITIES` array in `js/app.js` is). Corrected to reflect reality on 2026-05-29 (`sql/fix-cities-table-accuracy.sql`): `active` = launched markets only (SD + OC), counts = real active venue/event counts. The `active` flag is a manual launch decision; the counts are point-in-time and can drift as venues are enriched — re-run that script to refresh.
- `venues` — uuid PK, city_slug, name, neighborhood, address, lat, lng, hours, days[], cuisine, deals[], promo_code, promo_description, photo_url, photo_urls[], phone, place_id, google_rating, price_level, owner_id, owner_verified, stripe_customer_id, stripe_subscription_id, subscription_tier (`free`/`pro`/`founding`), subscription_status, subscription_current_period_end, amenity booleans (`has_happy_hour`, `has_live_music`, `has_trivia`, `has_karaoke`, `has_sports_tv`, `is_dog_friendly`, `has_bingo`, `has_comedy`), hours_start, hours_end, is_official, active, featured.
- `events` — similar shape, with `event_type` (Trivia, Live Music, Karaoke, Bingo, Game Night, Comedy).

**User core**
- `profiles` — id (auth.users FK), display_name, digest_enabled, **`last_seen`**, **`referred_by`**, is_official.
- `reviews` — venue_id OR event_id, user_id, name, rating 1-5, text.
- `favorites` — user_id, item_id (text), item_type.
- `neighborhood_follows` — user_id, neighborhood.
- `push_tokens` — user_id, token, platform ('web'/'ios'/'android'/'native'). Unique per (user, platform).

**Social** (DDL not in `sql/` — applied via SQL editor)
- `check_ins` — user_id, venue_id, city_slug, date, note. Unique `(user_id, venue_id, date)`.
- `checkin_photos` — user_id + media (photo/video).
- `activity_feed`, `social_likes`, `social_comments`, `user_follows`.
- `notifications` — actor_id, type, post_id, post_type (fires `trg_notify_on_tag` and `trg_notify_on_like`).
- `post_tags` (`sql/post_tags.sql`) — post_id, tagged_user_id, tagged_by.

**Giveaway / referral** (`sql/giveaway_system.sql`)
- `referral_codes` — user_id PK, code unique (6-char, no 0/O/1/I).
- `referrals` — referrer_id, referee_id (UNIQUE), referral_code_used.
- `giveaway_entries` — user_id, week_start, entry_type, source_referee_id. Partial unique indexes.
- `giveaway_winners` — week_start UNIQUE, winner_user_id, prize_status.
- `signup_attributions` — user_id PK, source, source_other.
- Helpers: `current_week_start_pt()`, `generate_referral_code()`, `grant_giveaway_entries()`, `is_giveaway_admin()`.
- Edge function: `supabase/functions/pick-giveaway-winner/index.ts`.

**B2B / CRM** (`sql/crm-tables.sql`)
- `crm_contacts` — contact_name, business_name, email, phone, city_slug, stage (`lead`/`contacted`/`demo`/`proposal`/`won`/`lost`), venue_id, source. RLS: `WITH CHECK (true)` (admin via service role).
- `crm_notes` — contact_id, note, author.
- `crm_activities` — contact_id, activity_type, description, meta (jsonb).
- `venue_requests` — user-submitted venue add suggestions.
- `venue_claims` — owner claim submissions (status, contact_name, business_name, contact_email, etc.).

**Admin tooling**
- `board_cards` — see Project Board section.
- `content_posts` (`sql/add-content-posts.sql`) — caption, scheduled_date/time, status, platforms[], tags[], media_urls[].
- `blog_posts` — slug, title, status, author, tag, excerpt, meta_description, keywords, featured_image_url, content (markdown).
- `email_templates` — id, name, description, payload (jsonb builder state).
- `site_copy` — page, key, value (unique on `page+key`).
- `feedback` — user feedback log.
- `newsletter_subscribers` — email opt-ins.
- `enrichment_runs` (`sql/enrichment_runs.sql`) — Google Places audit log; cost in micro-USD.

**Storage buckets**
- `checkin-photos` — image + video MIME types.
- `venue-photos` — written by enrichment as `${citySlug}/{venueId}/{idx}.jpg`.

**Postgres extensions:** `pg_net`, `pg_cron` (see `sql/push_triggers.sql`).

### Env var canon — WARNING: two conventions exist
| Var                        | Used by                                              |
|----------------------------|------------------------------------------------------|
| `SUPABASE_URL`             | mainline (`auth.js`, `spots.js`, `sitemap-venues.js`, `blog-post.js`, `admin-enrich-venues.js`, `send-push.js`, `stripe-*.js`) |
| `SUPABASE_SERVICE_KEY`     | mainline                                             |
| `NEXT_PUBLIC_SUPABASE_URL` | cron-only (`loops-inactive.js`, `daily-deals.js`)    |
| `SUPABASE_SERVICE_ROLE_KEY`| cron-only                                            |

Both pairs point at the same project. When writing new code, **match the
neighborhood** — copying from a cron file? Use the `_ROLE_` convention.
Copying from a mainline file? Use the bare convention.

### Full env var inventory
- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `LOOPS_API_KEY`
- `CRON_SECRET`
- `PUSH_API_KEY`
- `VAPID_PRIVATE_KEY` (inert)
- `APNS_KEY_BASE64`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (default `biz.spotd.app`)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`
- `NEXT_PUBLIC_SITE_URL` (default `https://spotd.biz`)
- `GOOGLE_PLACES_API_KEY`
- `DATABASE_URL` / `SUPABASE_DB_URL` (run-migration only)

---

## Frontend conventions

- **Vanilla JS, no jQuery.** `document.querySelector(All)`, `getElementById`.
- **PostgREST query style:** `?id=eq.{uuid}`, `?<col>=is.null`, `?or=(...)`,
  `?select=*,venue:venues(name,city_slug)`, `Prefer: return=minimal` or `return=representation`,
  `?on_conflict=<col>` for upserts.
- **Cache busting:** `?v=YYYYMMDD<letter>` on JS/CSS imports in `index.html` (e.g. `?v=20260408a`).
- **Service worker:** `sw.js` at repo root; PWA manifest in `manifest.json`.
- **iOS WKWebView:** UA-sniff (`/iPad|iPhone|iPod/.test(navigator.userAgent)` etc.) to
  branch native-only behaviors. Don't use `confirm()` — iOS WKWebView swallows it (PR #163).
- **Coral primary:** `#FF6B4A`. Cream background: `#F5EFE6`.
- **Desktop layout:** mobile-first, with TWO desktop breakpoints, both in
  self-contained blocks at the END of `css/style.css`:
  - `@media (min-width:1024px)` — centres `.app-page` in a 1040px frame, shows
    the `.desktop-nav` (top nav, hidden below 1024px), hides the mobile
    `.bottom-nav`, and turns the feed into a 2-column grid via
    `.card-hero-row`/`.card-std-row` wrappers that are `display:contents` on
    mobile (so mobile is untouched) and `display:grid` on desktop.
  - `@media (min-width:1200px)` — **locked two-pane discover view**: `.app-page`
    becomes a `height:100vh` flex column (header on top, two-pane row below);
    the page itself does NOT scroll. Left pane = an independently scrollable
    `#listView` (fixed `460px`, `overflow-y:auto`); right pane = the map filling
    the rest at full height. Both `#listView`/`#mapView` forced visible with
    `!important` (overriding the `.active` toggle); map toggle + the map's own
    `.map-sidebar` hidden. The feed renders as **uniform horizontal `.card-std`
    cards** here (no hero/compact/standard tiers) — `_renderCardsNow` branches
    on `isTwoPane()`. JS: `isTwoPane()` / `syncTwoPaneMap()` (near `goToMap`)
    init + populate the map; `enterCity` and `applyFilters` keep markers synced
    without a toggle; a matchMedia `change` listener re-renders the feed when
    crossing the breakpoint. **Gotcha:** `enterCity` sets
    `appPage.style.display=''` (not `'block'`) so the flex-column CSS isn't
    overridden by an inline style.
  Keep desktop overrides in those two blocks.

### File naming
- **Kebab-case** for everything: `admin-enrich-venues.js`, `loops-event.js`, `business-landing.html`.
- API filenames map 1:1 to route names in `vercel.json`.
- Admin extension scripts live at **repo root** (NOT inside `admin/`): `admin-attribution.js`, `admin-claims.js`, `admin-enrichment.js`, `admin-giveaway.js`.
- `admin/` subdirectory holds full HTML pages: `admin/board.html`, `admin/giveaway.html`.

---

## Push notification pipeline

- VAPID + APNs via Web Crypto, no SDK.
- DB → `pg_net` → `POST /api/send-push` with `Bearer ${PUSH_API_KEY}`.
- Triggered from:
  - `on_venue_activated` trigger on `venues`
  - `happy-hour-reminder` cron (11 PM UTC = 4 PM PT) — daily broadcast
  - `trg_notify_on_tag` via `send_push_to_user()` Postgres function
  - Admin Push composer tab (manual sends)
- Audience filter: includes "Just Me" option for self-testing (PR #73dcfaf).

---

## Recent direction (last ~60 days)

For pattern recognition. Don't propose work that's already been done.

- **Social v3 / feed / composer** — PRs #145, 146, 152, 153, 154, 157-168 (very heavy)
- **Admin portal extensions** — Claims (#157), Demo Data (#158), board persistence + dashboard (#141-143), inline venue edit (#139), board tabs (#138), board PWA layout (#132-137), newsletter (#131), content calendar (#128), blog editor (#127), Asset Generator (#98-103), venue load pagination (#95-97)
- **Google Places enrichment** — PR #162 (OC launch prep)
- **Onboarding / attribution** — #149, 150 (animated walkthrough)
- **iOS / WKWebView** — #163 (no confirm()), #110, 108, 87-89 (directions), banner-hiding (#79, 94)
- **APNs iteration** — sandbox toggle, ES256 JWT debugging, per-device error tagging
- **Performance** — #165-167 (perf rounds 1-3)

---

## Launching a new city

Cities are gated by the **hardcoded `CITIES` array in `js/app.js`** — NOT the
Supabase `cities` table. (The `cities` table was corrected on 2026-05-29 to
mirror reality, but its counts still drift as venues are enriched and its
`active` flag is a manual launch decision — so keep driving the UI from the
`CITIES` array, not the table.) A city should only go `active:true` once its
venues are actually enriched (photos + deals), otherwise the grid/map/SEO
sitemap look empty.

To open a new city end-to-end:

1. **Verify the data is ready.** Confirm a healthy count of `active` venues with
   `photo_url` set and `deals` populated for that `city_slug` (the SEO sitemap
   only includes venues with a photo, so photoless venues stay out of Google).
   San Diego + Orange County are the live markets as of 2026-05-29.
2. **Flip the flag** in `CITIES` (`js/app.js`): set `active:true` and a real
   `venue_count` (the home-grid "X+ spots" badge). Keep markets without enriched
   data `active:false` (currently LA/NYC/Chicago/Austin/Miami — they have seed
   rows but zero photos).
3. **Map center:** add the city's `[lat,lng]` to `getCityCenter()` (`js/app.js`).
   The in-app neighborhood/area filter is data-driven (derived from loaded
   venues), so it needs no per-city wiring.
4. **Onboarding:** add a `OB_CITY_CONFIG[slug]` entry in `js/onboarding.js`
   (`name`, `state`, `tagline`, `neighborhoods`, `featured`, `mapPins`). The
   onboarding city-picker screen (screen 1) renders one button per config key,
   so the city appears there automatically. Copy is city-aware via the `{city}`
   token. Use **real venues/neighborhoods** for `featured`/`neighborhoods` so the
   preview isn't fake.
5. **SEO copy:** add the city to the `index.html` meta description / og / keywords
   list, and the BTF social-proof line, then **bump the `?v=` cache string** on
   `js/app.js` + `js/onboarding.js`.
6. **Blog (optional):** add a city filter button + name mapping in `blog.html`
   and a `NEWS_ARTICLES` entry in `js/app.js` if there's a city guide post.

Picking a city in onboarding writes `spotd-last-city`, so a new signup lands
directly in the city they chose (`enterCity` reads it on next load).

## Docs

- `docs/giveaway.md` — full giveaway + referral system spec
- `docs/editor-account.md` — official editorial account model (`is_official` flag, auto-follow triggers)

---

## Blog post SEO checklist

When creating or updating a static blog post in `blog/`, apply these to every post:

1. **Non-blocking Google Fonts** — Replace `<link rel="stylesheet" href="...fonts...">` with:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/..." rel="stylesheet" media="print" onload="this.media='all'">
   <noscript><link href="https://fonts.googleapis.com/..." rel="stylesheet"></noscript>
   ```
2. **Article JSON-LD — required fields (avoids Rich Results Test warnings):**
   - `"image"` — a representative image URL **≥1200px wide** (use the post's `NEWS_ARTICLES` Unsplash hero with `w=1200`, NOT the 512px `icon-512.png`). Missing → "Missing field image" warning.
   - `"datePublished"` / `"dateModified"` — **full ISO 8601 with timezone**, e.g. `2026-05-31T08:00:00-07:00` (Pacific: `-07:00` Mar–early Nov DST, `-08:00` otherwise). A bare `YYYY-MM-DD` triggers "Invalid datetime value" + "missing a timezone" warnings.
3. **FAQPage JSON-LD** — Add a second `<script type="application/ld+json">` block with `"@type": "FAQPage"` after the Article schema. 4 Q&As minimum. **The schema Q&As MUST exactly mirror the visible FAQ Q&As** (same count, same text) — a mismatch (e.g. 4 in schema, 3 visible) suppresses the FAQ rich result and can flag a structured-data manual action.
4. **Visible FAQ section** — Add `<h2>Frequently Asked Questions</h2><div class="blog-faq">` with `.blog-faq-item`/`.blog-faq-q`/`.blog-faq-a` classes inside `.blog-article-body`, before the closing `</div>`.
5. **In-body related links** — Add `<div class="blog-related"><h3>More San Diego guides</h3><ul>...</ul></div>` inside `.blog-article-body`, immediately before the FAQ section.
6. **Yelp external links** — Wrap first mention of each venue name (in body text, not headers/reference lists) with `<a href="https://www.yelp.com/biz/..." target="_blank" rel="noopener">`. Skip for how-to/guide posts without specific venues.
7. **Content expansion** — Aim for 1,200+ words on local guide posts. Add "The Plan", "What to Order", or other utility sections as needed.
8. **Wire the post** — Add card to `blog.html` grid, entry at top of `NEWS_ARTICLES` in `js/app.js`, URL to `sitemap.xml`.
9. **Bump cache** — Increment `?v=` query string on `js/app.js` import in `index.html`.

> **Tip:** after publishing, validate 2–3 posts in Google's [Rich Results Test](https://search.google.com/test/rich-results). Even the "(optional)" warnings (image, datetime/timezone) are worth clearing — they're cheap and improve eligibility.

Weekend-events posts (time-sensitive, short shelf life): font fix + Article schema only, skip FAQ/related/Yelp.

## About the user

- Solo founder, UK-based, primary email `shanerutter@gmail.com`.
- Lives in the admin portal — when discussing tooling, default to extending it.
- Has expressed frustration when Claude proposes parallel systems instead of
  extending what exists. **Read this file fully before proposing infrastructure.**
- Strong preference for: keeping things simple, not over-engineering, no parallel
  vendors, no JS frameworks, no premature abstractions.
- Recently got a new MacBook — can use full local Claude Code features (`gh` CLI,
  IDE integrations, MCP tools).

---

## Ideas / backlog

Append-only. Any unimplemented idea surfaced in conversation goes here so
future sessions can see what's been considered but not shipped. When an idea
ships, move it to "Recent decisions" with the PR or commit.

<!-- format:
- YYYY-MM-DD · short title — one or two sentences. (optional context link)
-->

- 2026-05-27 · Founder daily/weekly motivation brief — Considered building a
  daily morning email + project board to combat motivation slumps. **Killed**
  because spotd already has a project board (`admin/board.html`) and uses Loops
  for all email; the right move is to add a "daily brief" view inside the
  existing admin dashboard (or extend the `board_cards` widget on the admin
  landing page) rather than a parallel email pipeline. If revisited: extend
  `admin.html` dashboard widgets, query `board_cards` for due-soon cards, and
  optionally trigger a daily Loops event with a curated summary.
- 2026-06-03 · ~~Two-pane desktop list+map view~~ — **SHIPPED same day** (see
  Recent decisions). Built as a `@media (min-width:1200px)` block that renders
  the feed + Leaflet map side by side instead of toggling.

---

## Recent decisions

Append-only architectural / vendor decisions. One line per entry.

<!-- format:
- YYYY-MM-DD · <decision> — <why>. (PR or commit)
-->

- 2026-05-27 · Rewrote CLAUDE.md as the source of truth. Added a Stop hook
  (`.claude/hooks/stop-claude-md-check.sh`) that blocks turn-end if files
  changed but CLAUDE.md didn't, to enforce the "keep this file alive" meta rule.
- 2026-06-05 · **Immersive photo viewer: tapping user/venue now surfaces above the image.** In `_immersiveSlideHTML` (`js/app.js`) the `.imv-info-user` block had **no click handler at all**, so tapping the poster did nothing; and the viewer (`.imv`, `z-index:10000`) sits far above the venue modal (`.overlay` ~700) and profile sub-page, so anything opened from inside it stayed hidden behind the full-screen image until you manually closed it. Fix: the user block now `onclick`s `closeImmersiveViewer();openPublicProfile(user_id)` and the venue chip already did `closeImmersiveViewer();openModal(...)` — both dismiss the viewer first (its `imv--open` removal sets opacity:0 + pointer-events:none immediately, so the target is revealed as it fades) with `event.stopPropagation()`. `openPublicProfile` already routes a self-tap to `openProfile()`. Bumped `app.js?v=20260605e`.
- 2026-06-05 · **Profile fixes: "A spot" check-in names + cramped tab bar.** (1) The profile check-in list showed "A spot" for any check-in at a venue not in the currently-loaded city — `fetchAllCheckIns` (`js/db.js`) did `select('*')` from `check_ins` (which doesn't denormalize the venue name) and the render resolved names only from the in-memory `allItems` (current city). Now `fetchAllCheckIns` batch-fetches `venues(id,name,neighborhood)` for the distinct `venue_id`s and sets `r.venue_name`/`r.neighborhood`, so both own (`renderProfile`) and public (`renderPublicProfile`) check-in lists show real names across all cities. (2) The 5 profile tabs (Check-ins/Reviews/Saved/Lists/Tagged) were `flex:1` equal-width and cramped on narrow phones. Changed `.pf-tab` to `flex:1 0 auto` (+`padding:9px 16px`) and made `.pf-tabs-inner` horizontally scrollable (`overflow-x:auto`, hidden scrollbar) — tabs fill the bar when they fit (4-tab public profile) and scroll when they don't (5-tab own profile). `selectProfileTab`/`switchPubTab` (`js/app.js`) now `scrollIntoView({inline:'center',block:'nearest'})` the active pill. Bumped `style.css?v=20260605e`, `db.js?v=20260605d`, `app.js?v=20260605d`.
- 2026-05-29 · Nightly run: deferred Leaflet CSS+JS loading in `index.html` (media-print trick + `defer` attribute) so ~250KB of 3rd-party map scripts no longer block the critical render path. No changes to `app.js` — existing try/catch in `initMap()` handles lazy-load gracefully.
- 2026-05-29 · Added first Orange County blog post (`blog/best-happy-hours-orange-county.html`). Added OC entry to `NEWS_ARTICLES` in `js/app.js`, OC card to `blog.html` grid (top), OC URL to `sitemap.xml`. OC filter button was already present in `blog.html`. Note: `blog_posts` Supabase table does not exist despite CLAUDE.md reference — static HTML blog pipeline is the live pattern (all existing posts are static files in `blog/`).
- 2026-05-29 · Social handoff Notion page created for Cowork: https://www.notion.so/36f89936834b81e9bd6ac5904656d4a7 — IG carousel, Reddit r/sandiego post, X tier-list tweet, all OC-focused riding patio season + early-evening lifestyle trend.
- 2026-05-29 · **Launched Orange County as the 2nd live city.** Flipped `orange-county` to `active:true` in the `CITIES` array (`js/app.js`) and corrected stale badge counts (SD 400→498, OC→225). OC had 225 active venues / 173 with photos / 131 with deals — genuinely launch-ready. Reworked onboarding (`js/onboarding.js` + `index.html`) from hardcoded-San-Diego into a **per-city model**: added a city-picker screen (now screen 1 of 7), an `OB_CITY_CONFIG` map keyed by slug (neighborhoods/featured venues/map pins, populated with real OC data), and `{city}` token replacement in the rotating copy. Picking a city writes `spotd-last-city` so signups land in the chosen city. Refreshed SEO meta + BTF copy to include OC; bumped cache `?v=` on app.js/onboarding.js. Added the "Launching a new city" checklist above. Confirmed the Supabase `cities` table is unreliable (flags all cities active, wrong counts) — `CITIES` array remains the single UI gate. **Considerations flagged for Shane:** ~52 active OC venues have no photo (excluded from the SEO sitemap, shown with placeholder in-app); LA/NYC/Chicago/Austin/Miami still have zero-photo seed data so they correctly stay `active:false`.
- 2026-05-29 · **Corrected the `cities` table** (migration `fix_cities_table_accuracy`, also saved as `sql/fix-cities-table-accuracy.sql`). It previously flagged every city `active:true` with wrong counts (e.g. SD venue_count 85 vs real 498). Now: `active` = launched markets only (San Diego + Orange County), `venue_count` = real active venues, `event_count` = real active events. Found San Diego has 310 events but **all `active=false`**, so SD genuinely surfaces 0 live events today (the app queries events with `.eq('active', true)`) — flagged for Shane in case those 310 SD events should be reactivated. The table is still NOT the UI gate (the `CITIES` array is) and its counts can drift; re-run the SQL after enrichment to refresh.
- 2026-05-29 · **Events are no longer standalone cards anywhere.** Previously, events whose `venue_name` didn't match a venue (orphaned events) rendered as their own cards under an "Events" feed label (and as purple map pins). Now events surface **only on their venue**: a new `eventChipsHTML(v)` adds small event-type chips (e.g. "🧠 Trivia") to the hero/compact/standard venue cards, and the existing "Events at this venue" modal section stays. Changes in `js/app.js`: `applyFilters` pool is venues-only (removed `standaloneEvents`); built a `state._eventsByVenue` index in `enterCity`; removed the events section from `_renderCardsNow`; deleted the now-dead `eventCardHTML()`; neighborhood + type filters are venue-only (event types are found via the amenity filter). New `.card-event-chips`/`.card-event-chip` CSS. Note: the `setShowFilter`/`#showFilters` All/HH/Events toggle was already dead code (no UI), so `showFilter` is always `'all'`. **Flagged for Shane:** orphaned events (venue not in our `venues` table — e.g. OC's "Comedy at Irvine Improv", "Bingo at Neon Retro Arcade") now appear nowhere; to surface them, add the venue or fix the event's `venue_name` to match an existing venue.
- 2026-05-29 · **Fixed social-feed cache not keyed by city** (`loadSocialFeed`, `js/app.js`). The 60s in-memory cache (`_socialItems`/`SOCIAL_FEED_TTL_MS`) was checked before the current city was read, so switching cities within the TTL replayed the previous city's posts (San Diego posts showing under Orange County) and switching back refetched (visible delay). Added a `_socialFeedCity` guard so the cache only short-circuits for the same city; `citySlug` is now read at the top of the function. **Pre-existing latent bug** — dormant while San Diego was the only live city, exposed by the OC launch. OC's feed is now correctly near-empty (no social history yet) — consider a "be the first to post in OC" empty state and/or seeding activity. (Also: my earlier same-session claim that a "social feed pagination PR #170" had been reverted was WRONG — that came from unreliable git output in the remote env; no such PR exists, PR #170 is the nightly run, and the bogus restore PR #172 was closed unmerged.)
- 2026-06-02 · Nightly run: eliminated two render-blocking resources from `<head>` in `index.html`. (1) Moved Supabase SDK `<script>` from `<head>` to body (just before `db.js`) — removes a synchronous CDN JS fetch that was blocking page parse. (2) Made Google Fonts stylesheet non-blocking using the `media="print" onload="this.media='all'"` trick (same approach used for Leaflet CSS in the May 29 nightly run), plus added `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` for faster font file delivery. Both changes are safe: `db.js` still loads after the SDK in DOM order, and `display=swap` in the Fonts URL already handles FOUT gracefully. No functional code changes. Bumped `app.js` cache version to `?v=20260602a`.
- 2026-06-02 · Added North Park neighborhood guide blog post (`blog/best-happy-hours-north-park-san-diego.html`). Keyword: "best happy hours North Park San Diego". Venues verified: The Smoking Goat, Caffè Calabria, Bivouac Ciderworks, Crazee Burger, The Banshee Bar. Added card to top of `blog.html` grid, entry at top of `NEWS_ARTICLES` in `js/app.js`, URL to `sitemap.xml`. Blog pipeline remains static HTML — `blog_posts` Supabase table still does not exist. Nightly run target city: San Diego (alternating from OC on 2026-05-29).
- 2026-06-02 · **City-aware empty state for the public social feed** (the no-posts block in `renderSocialTab`, `js/app.js`). When the public tab has no items + no pinned editorial posts, it now reads `state.city.name` and shows "Be the first in <City>" with a CTA `<button onclick="bottomNavFeed()">` to the discover feed. Reuses the existing `.social-empty` / `.social-share-cta` styles — no new CSS. NOTE: PR #174 was a failed first attempt — its `js/app.js` edits silently did not apply (string mismatch), so #174 shipped only a cache-bump + an inaccurate CLAUDE.md line describing a `renderPublicEmptyState()`/`switchMainView()` design that never existed. That bad line is removed and replaced by this accurate one. LESSON: in this remote env, `git status`/`git diff` are unreliable — always verify via file contents and `git show <ref>:<path>` before committing/merging.
- 2026-06-03 · **Shipped a true desktop layout (≥1024px).** The app was mobile-first with no real desktop styling — on wide screens it rendered as a narrow ~720px column of cards (the feed-redesign `.cards-grid{max-width:720px}` at `style.css:3083`) floating in empty space, with full-bleed chrome and the floating mobile pill nav still showing. Added one self-contained `@media (min-width:1024px)` block at the **end of `css/style.css`** (after the social-feed styles) that: (1) turns the existing `.city-bar` into a real **top nav bar** — added a `<nav class="desktop-nav">` inside `.city-bar` in `index.html` with Discover/Explore/News/+Post/Profile buttons that **reuse the existing `bottomNav*()` handlers + `openComposer()`**; (2) hides the floating `.bottom-nav` on desktop; (3) centres the whole `.app-page` in a **1040px frame**; (4) widens the feed into a clean **two-column magazine grid** (heroes 2-up, compact 2-up, standard rows 2-up) while keeping the editorial hero→compact→standard flow; (5) roomier map view (`calc(100vh-150px)`, 340px sidebar). **Multi-column without touching mobile:** `_renderCardsNow` now wraps the hero tier in `.card-hero-row` and the standard tier in `.card-std-row` (compact already had `.card-compact-row`); these wrappers are **`display:contents` by default** (so on mobile the cards behave as direct `.cards-grid` children — rendering is byte-identical) and flip to `display:grid` only at ≥1024px. Compact/hero images get a landscape `aspect-ratio` on desktop (`16/10` hero, `16/11` compact) so half-width cards don't become towers. New global defaults `.desktop-nav{display:none}` + `.card-hero-row,.card-std-row{display:contents}`. Bumped cache to `style.css?v=20260603a` + `app.js?v=20260603a`. **Verified** by rendering a faithful harness (real `style.css` + mock card markup) in headless Chromium at 1280/1440/390px. **Backlog flagged below:** the editorial feed doesn't want to stretch ultra-wide, so the 1040px frame still leaves cream margins on big monitors — the real "use the width" move is a two-pane list+map desktop view (the persistent `.map-sidebar` already half-exists at ≥960px).
- 2026-06-03 · **Desktop two-pane list+map view (≥1200px).** Follow-up to the
  same-day desktop layout. The classic discovery pattern (Yelp/Airbnb): the
  feed (left, single column, `max-width:660px`) and a persistent Leaflet map
  (right, `position:sticky;top:0;height:100vh`) are shown side by side instead
  of toggling. Added a `@media (min-width:1200px)` block at the end of
  `css/style.css` that forces both `#listView`/`#mapView` visible with
  `!important` (overriding the existing `.active` toggle), reverts the feed to a
  single column (`.card-hero-row,.card-std-row{display:contents}`), hides the
  now-pointless `#viewToggle` and the map's own `.map-sidebar` (the left feed
  replaces it). JS (`js/app.js`): new `isTwoPane()` (matchMedia 1200) +
  `syncTwoPaneMap()` (inits if needed, `invalidateSize` + `updateMapMarkers`)
  near `goToMap`; `enterCity` calls `syncTwoPaneMap()` right after `initMap()`
  so the map is populated without a toggle; `applyFilters` now calls
  `updateMapMarkers()` when `state.view==='map' || isTwoPane()` (previously
  map-view only) so markers track filters in the always-on pane; `goToMap`
  skips the toggle in two-pane and just `flyTo`s; added a matchMedia `change`
  listener (populate on crossing into two-pane) and a debounced window `resize`
  → `invalidateSize`. Bumped cache to `?v=20260603b`. **Verified** the layout
  in headless Chromium at 1280/1440px (map pane shown as a placeholder in the
  harness since Leaflet needs the live CDN/data). **Needs a real-browser check
  with live venue data** to confirm tiles + markers render in the right pane.
- 2026-06-03 · **SEO pass on all 16 blog posts**: added FAQPage JSON-LD schema + visible Q&As (`.blog-faq` pattern), internal cross-links (`div.blog-related` inside body), Yelp external links on first venue mention, non-blocking Google Fonts (`media="print"` trick + `fonts.gstatic.com` preconnect + `<noscript>` fallback) across all posts. Expanded Taco Tuesday post (~+350 words) and Little Italy post (~+400 words). Added `.blog-faq` and `.blog-article-body .blog-related` styles to `css/blog.css`. Blog SEO checklist added below. Weekend-events posts got font fix only (no FAQ/links).
- 2026-06-03 · Nightly run: added `<link rel="preconnect">` for `opcskuzbdfrlnyhraysk.supabase.co` and `cdn.jsdelivr.net`, plus `<link rel="dns-prefetch">` for `www.googletagmanager.com` in `index.html`. Pre-establishes TCP+TLS connection before JS executes, saving ~100–300ms on first Supabase venue query. Previously only fonts.googleapis.com had preconnect hints. Bumped `app.js` cache to `?v=20260603a`.
- 2026-06-03 · Added Newport Beach neighborhood guide blog post (`blog/best-happy-hours-newport-beach.html`). Keyword: "best happy hours Newport Beach". Deeper city-specific companion to the general OC guide. Venues verified: Zinqué (Yelp May 2026), Muldoon's Irish Pub (Yelp June 2026), Woody's Wharf, Bosscat Kitchen & Libations, Balboa Bar, The Winery Restaurant. Wired into `blog.html` grid (top), `sitemap.xml`, and `NEWS_ARTICLES` in `js/app.js`. Blog pipeline remains static HTML.
- 2026-06-03 · **Fixed Rich Results Test warnings on all 17 blog posts' Article schema.** (1) Added an `"image"` field to every Article JSON-LD using the post's `NEWS_ARTICLES` Unsplash hero bumped to `w=1200` (the og:image `icon-512.png` is only 512px — too small). (2) Converted `datePublished`/`dateModified` from bare `YYYY-MM-DD` to full ISO 8601 with Pacific timezone (`...T08:00:00-07:00`) — bare dates triggered "Invalid datetime value" + "missing a timezone" warnings. Applied via a Python script that re-serializes only the `@type:Article` JSON-LD block per file (FAQ/Breadcrumb blocks untouched); all 39 JSON-LD blocks across the 17 posts re-validated as parseable. Also caught + fixed an earlier mismatch (best-tacos/best-burritos had 4 schema FAQ Q&As but only 3 visible). Updated the Blog post SEO checklist with the required Article fields + the schema-must-mirror-visible-FAQ rule.
- 2026-06-03 · Social Handoff Notion page created: https://app.notion.com/p/37489936834b815d82f0e9e2b36719e3 — OC engagement-focused carousel riding the "Hallelujah" Justin Bieber format + digicam aesthetic. Venues: Old World Festival Hall (HB), Perqs Bar (HB, all-day Wednesday HH), Postino Park Place (Irvine), Zinqué (Newport Beach). Reddit r/orangecounty editorial post + X tweet included. All venues verified open tonight.
- 2026-06-03 · **Two-pane refinement: locked-scroll left list + uniform cards.** Iterated on the ≥1200px two-pane (shipped earlier same day). (1) **Locked layout:** `.app-page` is now a `height:100vh` flex column (`overflow:hidden`) so the page no longer scrolls — only the left `#listView` (fixed `460px`, `overflow-y:auto`) scrolls, with the map filling the rest at full height (dropped the previous `position:sticky` page-scroll approach). (2) **Uniform cards:** `_renderCardsNow` now branches on `isTwoPane()` and renders all venues as same-shape horizontal `.card-std` cards (no hero/compact/standard tiers) — a scannable Yelp-style list beside the map. A matchMedia `change` listener calls `renderCards()` so the card style swaps when crossing 1200px. (3) **Gotcha fixed:** `enterCity` was setting `appPage.style.display='block'` inline, which would beat the flex-column CSS — changed to `display=''` (default div display is block; hiding still uses inline `display:none`). Bumped cache to `?v=20260603d`. Verified in headless Chromium at 1280/1440px.
- 2026-06-03 · **Consolidation: shipped 3 blog posts from stale nightly PRs** (#176–178). Added `blog/best-taco-tuesday-san-diego.html` (Jun 1, El Chingon/American Junkie/Barleymash/La Puerta) and `blog/best-happy-hours-little-italy-san-diego.html` (May 31, Ironside/Cloak & Petal/GlassDoor/Piedra Santa/Vincenzo) — cherry-picked blog HTML from the old branches and committed fresh on `claude/consolidation-blog-fixes`. Closed PRs #176/177/178 as superseded. Wired both posts into `blog.html` grid, `sitemap.xml`, and `NEWS_ARTICLES` in `js/app.js`. Fixed broken Unsplash image for North Park entry in `NEWS_ARTICLES` (replaced 404 ID `photo-1574920162043-b872873f19bc` with `photo-1514362545857-3bc16c4c7d1b`). Fixed stale Supabase `deals` data for two North Park venues: The Smoking Goat (hours corrected to 5:30–7pm Mon–Sun) and Caffè Calabria (hours corrected to 6–10pm Wed–Sun, all-day Wednesday), via direct SQL `array_replace`.
- 2026-06-03 · **Simplified venue UGC to a single voice mechanism: Reviews.** Removed three competing inputs that overwhelmed users. (1) **Killed the "going-out intent" feature entirely** — the 🍻 Going button, `openGoingIntentSheet`, `postGoingIntent`/`fetchVenueGoingTonight` (`js/db.js`), the per-venue "Going tonight" strip, and the buggy `trg_going_notify_followers` DB trigger that inserted `type='mention'` notifications for every follower on each intent (this was the "Kourtney Rutter mentioned you" false-mention bug — she'd only RSVP'd). Migration `sql/drop-going-intents-trigger.sql` applied (drops trigger + function; `going_intents` table + rows left intact, non-destructive). The separate **check-in** feature is untouched (`doGoingTonight`/`goingCounts`/`goingByMe` keep their legacy "going" internal names) — only its user-facing copy was reworded to check-in language ("🔥 N here", "N people checked in tonight", feed verb for `going_tonight` items → "checked in at"). (2) **Removed the "How would you describe…?" descriptions / "Locals Say" system** from cards + modal: `localsSaySnippet`/`localsSayInline`/`loadModalDescriptions`/`doSubmitDescription`/`doToggleUpvote` (`js/app.js`) and `fetchTopDescriptions`/`fetchVenueDescriptions`/`submitVenueDescription`/`toggleDescUpvote`/`fetchMyUpvotedDescs` (`js/db.js`) deleted; `state.descCache` removed. (3) **Removed "Quick takes"** (`venue_takes`): `renderVenueTakes`/`submitVenueTake`/`deleteVenueTakeUI` + `fetchVenueTakes`/`postVenueTake`/`deleteVenueTake`. Tables `venue_descriptions`/`description_upvotes`/`venue_takes` left in DB (data kept, just not shown). Updated `business-landing.html` B2B copy (4 "Going Tonight" mentions → check-in) and admin demo-data label/comment. Bumped `index.html` cache: `db.js?v=20260603b`, `app.js?v=20260603b`. NOTE: the `'mention'` notification label still exists in `openSocialNotifications` (`js/app.js`) but nothing creates that type anymore — it's dead-but-harmless; pre-existing bogus `mention` rows in `notifications` were left in place.
- 2026-06-04 · **Nightly run: lazy-load off-screen hero images (PR #187).** `heroCardHTML` now accepts an `idx` parameter (default 0); only the first hero card uses `loading="eager"`, all subsequent heroes use `loading="lazy" decoding="async"`. Previously all hero cards loaded eagerly regardless of scroll position, causing the browser to queue every hero photo at page load. In a city with 10–20 featured venues this is meaningful network savings on initial render. Call site at `_renderCardsNow` passes the forEach index. Risk: low. Two-pane mode unaffected (heroes never render there). Bumped `app.js?v=20260604b`.
- 2026-06-04 · Added Hillcrest neighborhood guide blog post (`blog/best-happy-hours-hillcrest-san-diego.html`). Keyword: "best happy hours hillcrest san diego". Venues verified: Hillcrest Brewing Company (daily 2–6pm), Baja Betty's (Papi Hour 2–6pm + extended 6pm–close), Common Stock (weekday HH), Starlite (daily 5–7pm), Fort Oak (Tue–Sun 4–6pm). Full SEO checklist applied. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `js/app.js`. Blog pipeline remains static HTML.
- 2026-06-04 · Social Handoff Notion page created: https://app.notion.com/p/37589936834b81b7800bc2eca3383b44 — SD Hillcrest-focused "Things That Just Make Sense" carousel (Wed - Engagement). Venues: Hillcrest Brewing Company, Baja Betty's, Common Stock, Starlite, Fort Oak. Reddit r/sandiego editorial post + X tweet included. All venues verified open tonight. Trends ridden: "Things that just make sense" text carousel + "No one's talking about" editorial frame.
- 2026-06-04 · **Fixed the canonical-host mismatch that was blocking indexing (the GSC root cause).** Every page's `<link rel="canonical">` / `og:url` / JSON-LD URL / sitemap `<loc>` pointed at the apex `https://spotd.biz/...`, but the apex 301/307-redirects to `https://www.spotd.biz/...`. Google saw "canonical points at a URL that immediately redirects" and labelled ~all pages "Alternate page with proper canonical tag" → only 27 of ~1,000 venue pages indexed. **Fix: canonicalize everything to `www`** (the host that serves 200). Added `const SITE_URL = 'https://www.spotd.biz'` to the 3 edge renderers (`api/spots.js`, `api/blog-post.js`, `api/sitemap-venues.js`) and routed canonical/og:url/og:image/JSON-LD breadcrumb+publisher hosts through it; added `<meta name="twitter:url">` to `api/spots.js`. Rewrote apex→www in all static SEO files via `sed 's#https://spotd\.biz#https://www.spotd.biz#g'`: `index.html`, `blog.html`, `terms.html`, `privacy.html`, `sitemap.xml`, and all 17 `blog/*.html` (canonical + og:url + og:image + JSON-LD). Added a missing canonical/og:url/robots to `business-landing.html`. Aligned the referral share link in `js/app.js` (`openReferralShareSheet`) from apex→www and bumped `app.js?v=20260604c`. Left functional non-URL refs untouched (`mailto:support@spotd.biz`, prose "(spotd.biz)"). Also lightly enriched `api/spots.js` LocalBusiness JSON-LD `PostalAddress` with `addressLocality` (from city) + `addressCountry:'US'` (region/postal not reliably stored, so omitted rather than guessed). Did NOT touch the redirect direction (apex→www stays). **Manual GSC follow-ups remain (cannot be done from code):** resubmit the two www sitemaps + click "Validate Fix" on the canonical issue, then Request Indexing for the homepage / top venue pages / best blog post. Recorded the canonical-host rule under "Vercel project" above.
- 2026-06-05 · **Fixed broken hero image on the News tab.** The featured Hillcrest article rendered a broken-image placeholder (blue "?" box) because its Unsplash ID `photo-1574052009741-d038dc3df0e7` 404s. Replaced it with the verified-working cocktail image `photo-1514933651103-005eec06c04b` in all 4 references: `NEWS_ARTICLES` in `js/app.js` (`w=800` thumbnail) and the blog post's og:image + twitter:image + Article JSON-LD `image` in `blog/best-happy-hours-hillcrest-san-diego.html` (`w=1200`). Same failure class as the earlier North Park 404 (2026-06-03). Verified both old (404) and new (200) IDs via curl. Bumped `app.js?v=20260605c`. **Reminder for future blog posts: curl-check the chosen Unsplash ID returns 200 before wiring it into `NEWS_ARTICLES` — dead IDs ship a broken hero.**
- 2026-06-05 · Smoothed the discover **Filters panel** open/close (`#filterPanel`, `css/style.css`). It animated `max-height:0→500px`, but the real content is only ~300px, so the easing spent its back half overshooting to 500px = perceived lag/dead-time (and `max-height` forces layout each frame). Switched to animating `grid-template-rows:0fr→1fr` on `.filter-panel` with `overflow:hidden;min-height:0` on `.fp-inner`, so it interpolates to the panel's *exact* content height — no overshoot, snappier. JS toggle (`toggleFilters`) unchanged. Graceful-degrades on iOS <16 (snaps open, no animation). Bumped `style.css?v=20260605c`.
- 2026-06-05 · **Filters panel lag, round 2 — the grid-rows fix wasn't enough.** Still janky on device because the panel was animating its height *in document flow*, so every frame pushed `<main>` (the 499-card venue list) down and forced a full re-layout + repaint of all those cards — that, not the overshoot, was the real cost (and `grid-template-rows` is itself expensive for Safari to recompute each frame). Re-implemented `.filter-panel` (`css/style.css`) as an **absolute dropdown** (`position:absolute;top:100%` inside the already-`position:sticky` `.controls`) that overlays the list instead of pushing it, animating **only `transform:translateY` + `opacity`** (GPU-composited, zero layout/paint per frame). Solid `var(--bg)` background + shadow + rounded bottom so it reads as a dropdown card; `max-height:72vh;overflow-y:auto` for safety; `visibility` toggled so it's not tap-targetable when closed. `.fp-inner` reverted to plain padding (no more `overflow:hidden`/`min-height:0`). JS `toggleFilters` still just toggles `.open`. Bumped `style.css?v=20260605d`. (Supersedes the grid-rows approach in the entry above.)
- 2026-06-05 · Follow-up fix to the check-in sheet: friend-chip avatars with a real photo (`avatar_url`) were rendering full-card-size because `initialsAvatar()` returns an `<img width:100%>` and `.tag-friend-chip-avatar` (`css/style.css`) only sized emoji via `font-size` — gave the avatar box an explicit 44×44 circular frame + `img{object-fit:cover}`. Emoji avatars were unaffected. Bumped `style.css?v=20260605b`.
- 2026-06-05 · **Redesigned the post-check-in sheet + fixed tags silently vanishing.** Two user-reported issues: (a) "I tagged someone and it didn't show up", (b) the post-check-in prompt was "complicated and ugly". **Root cause of (a):** the old `openPhotoCheckinPrompt` sheet (`js/app.js`) had a **two-button split** — a primary "Share Photo" button (which is the *only* place staged tags were committed, in `submitPhotoCheckin`) sitting *above* the "Who'd you go with?" tag chips, then a separate "Done" button. The natural flow (tap Share Photo, then notice the tag chips below and tap a friend) silently dropped the tag: the staged set was already reset and "Done" never wrote it. You also literally could not tag anyone without sharing a photo (`post_tags` rows reference a `checkin_photos.id`), and the **Trending tab never hydrated tags at all**. **Fixes (`js/app.js`):** (1) Rebuilt the sheet as one clean celebration card ("You're checked in! 🎉") with a **single primary action** (`submitCheckin`) that commits photo + caption + tags together — `submitPhotoCheckin` deleted/replaced. Button label is dynamic via new `_updateCheckinShareLabel()` (wired to caption `oninput`, photo add, and `toggleStagedTag`) so it reads "Share photo · N tagged" / "Tag N friends" / "Post check-in" / "Done". A subtle "Maybe later" ghost button + backdrop dismiss replace the old "Done". (2) **Tagging now works without a photo** — `submitCheckin` falls back to creating a lightweight `post_type:'text'` check-in (via `saveCheckinPhoto`) so the tag has a row to reference. (3) Broadened tag hydration in `loadSocialFeed` to include `type:'text'` posts (was photo-only); added tag hydration to `renderTrendingTab` (folded `fetchTagsForPosts` into its `Promise.all`). (4) **`fetchSocialFeed` dedupe (`js/db.js`):** a venue-tagged text check-in now suppresses the duplicate `going_tonight`/`check_in` row for the same user/venue/day (renamed `photoKeys`→`postKeys` to include `type:'text' && venue_id`), so a no-photo tagged check-in doesn't double-post next to the auto check-in card. After commit, the sheet force-refreshes the city feed (`loadSocialFeed({force:true})`) + the venue's UGC strip. New CSS (`css/style.css`): `.checkin-sheet` / `.checkin-celebrate*` / `.checkin-tag-head` (coral primary button — note `--teal` already resolves to `#FF6B4A` so it was on-brand already). Bumped cache `?v=20260605a` on `style.css` + `db.js` + `app.js`. NOTE: the standalone `openTagFriends`/`finishOpenTagFriends`/`toggleStandaloneTag`/`skipToTagFriends`/`maybeOpenTagFriends` overlay path is **dead** (no live callers — `skipToTagFriends` is never invoked) and was left untouched; the live flow is `doGoingTonight → maybeOpenPhotoCheckin → openPhotoCheckinPrompt`. **Not verifiable headless** (no Chromium in this env) — needs a real-device check that tagging-without-photo and the new single-button commit work end to end.
- 2026-06-04 · **SEO discovery + ranking build (Tasks 1–3).** Follow-up to the canonical-host fix (PR #188). GSC showed venue pages as "URL is unknown to Google / Referring page: None detected" — they were only reachable via the JS app + sitemap, so Googlebot had no crawl path. (1) **Discovery** — new `api/spots-directory.js` at `/spots`: a crawlable HTML index of all 665 indexable venues (active + `photo_url IS NOT NULL`, mirroring the sitemap), grouped by city with real `<a href="https://www.spotd.biz/spots/...">` links + `ItemList` JSON-LD. (2) **Ranking** — new `api/happy-hour.js` at `/happy-hour/<city>` + `/happy-hour/<city>/<neighborhood>`: SSR landing pages with unique data-driven copy (live counts, real venue names + deals pulled from Supabase), crawlable venue lists, day-filter chips (`?day=tuesday`, explicit-`days[]` matches only so day pages stay distinct), neighborhood chips, FAQ (visible + `FAQPage` JSON-LD mirrored per the blog rule), `ItemList` + `BreadcrumbList` JSON-LD, self-canonical (incl. `?day=`). Generic over any city with photo'd venues (SD 495 / OC 170 today). (3) **Internal linking** — added crawlable footer links to `/spots` + city/neighborhood pages on the homepage (`index.html`, new `.btf-footer-discover`, bumped `style.css?v=20260604d`), venue footer (`api/spots.js`), blog footer (`api/blog-post.js`), and a "Browse happy hours by area" block in `blog/best-happy-hours-san-diego.html`. Wired routes in `vercel.json` (`/spots` exact BEFORE `/spots/(.+)`; two-segment `/happy-hour` before one-segment; `/sitemap-cities.xml`). Added `/spots` + both city pages to static `sitemap.xml`; new dynamic `api/sitemap-cities.js`; updated `robots.txt` (Allow `/happy-hour/`, added `sitemap-cities.xml`, fixed venues sitemap line to `/sitemap-venues.xml`). Verified all handlers render via stubbed-fetch harness (200s, correct anchor counts, www canonicals, no apex leaks, all JSON-LD blocks parse; Tuesday filter correctly drops empty-`days` venues). **Manual GSC follow-up after deploy:** submit `sitemap-cities.xml`, Request Indexing for `/spots` + `/happy-hour/san-diego` (high-value crawl entry points). **Backlog:** the day-page copy could be deepened; consider a `/happy-hour/orange-county` neighborhood link set in the OC blog post; non-launched cities (LA/NYC/etc.) have photoless venues so they correctly stay out of `/spots` and the city pages 404.
