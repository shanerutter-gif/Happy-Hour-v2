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
| iOS push       | APNs (ES256 JWT, `node:http2`) | `api/_lib/apns.js`, shared by `api/send-push.js` + `api/push-runner.js` (both **Node runtime** — APNs is HTTP/2-only) |
| Web push       | VAPID (currently inert — keypair mismatch) | web rows excluded from `send-push`'s token query; old Edge VAPID code removed in the 2026-06-12 Node conversion |
| Venue data enrichment | Google Places       | `api/admin-enrich-venues.js`                         |
| Maps           | Leaflet 1.9.4 + markercluster 1.5.3 | unpkg CDN in `index.html`                  |
| Analytics      | GA4 (`G-5271Q2407Q` — the ONLY property; an earlier version of this row wrongly said `G-9PXGE6LEPE`) | gtag loaded in `index.html`; `track()` helper in `js/db.js:25` |
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
   `export const config = { runtime: 'edge' };`. Exceptions: `api/run-migration.js`
   (Node, needs `pg`) and `api/send-push.js` + `api/push-runner.js` (Node —
   APNs is HTTP/2-only and Edge fetch can't negotiate it; every Edge APNs send
   failed with an opaque "Network connection lost").
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
4. Never enable web push without generating a fresh, matching VAPID keypair and
   writing a Node-runtime web-push sender — the old Edge VAPID code (and its
   mismatched hardcoded public key) was removed from `api/send-push.js` in the
   2026-06-12 Node conversion.
4b. Never build an absolute URL to the push/cron endpoints with bare
   `spotd.biz` — always `https://www.spotd.biz`. The apex 308-redirects to www
   and HTTP clients strip the `Authorization` header on the cross-host
   redirect (this silently 401'd every automated push for ~3 months).
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
HTML from the GitHub Contents API (`?ref=main`) and **injects 5 extension
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
|               | `nav-push`          | **Push Center** — composer, schedule/recurring, automations, merged history | `push_tokens` → `/api/send-push`; `push_campaigns`/`push_automations`/`push_automation_log` → `/api/push-runner` (scheduling+automations UI injected by `admin-push-center.js` into the existing `#page-push`) |
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
- `POST /api/loops-event` — generic event passthrough. Client fire-and-forget `sendLoopsEvent()` in `js/db.js`.
- `POST /api/loops-update-contact` — generic contact-property update (`contacts/update`, PUT). Client helpers `updateLoopsContact()` / `markLoopsActivated()` in `js/db.js`. Flips `userGroup:'activated'` on first check-in (guarded by localStorage `spotd-loops-activated`).
- `POST /api/loops-onboarding` — `POST /contacts/create` (idempotent, 409 = ok) then event `signup`. Also writes onboarding-context custom props sent by the client (`city_slug`, `cityName`, `vibes`, `platform`, `sourceDetail`) gathered by `_loopsSignupContext()`; props only included when present so blanks never overwrite.
- `GET /api/loops-inactive` (cron) — re-engagement. Inactivity = `coalesce(last_seen, created_at)`; sends to "older than 7d / 30d AND not already re-engaged" (NOT exact-day bands), then stamps `profiles.reengaged_7d_at` / `reengaged_30d_at` so a cohort is never re-emailed (30d takes precedence → one event/run). Every failure path `console.error`s the named env var / fetch. `?key=<service_role>` returns per-cohort counts.
- `GET /api/daily-deals` (cron) — **per active city**: loops `cities.active=true`, picks up to 3 of *that city's* deal venues (rotated by day-of-year), and sends `daily_deals` (props `cityName` + `venueN_*` + `date_formatted`, nested under `eventProperties`) to that city's subscribers = `profiles.city_slug = <slug>` with `digest_enabled` not false, emails resolved via the Supabase admin API. ⚠️ **Recipients are DB-driven off `profiles.city_slug`, NOT Loops** (Loops has no list-all endpoint; that 404 sent 0 before 2026-06-09). No hardcoded slugs — activating a new city auto-enrolls its users. Selects `venues.hours` (NOT phantom `hours_start`/`hours_end`). Returns `{success, cities[], recipients, sent, errors, perCity:{slug:{venues[],recipients,sent}}}`.
- `GET /api/weekly-digest` (cron, Thu `0 15 * * 4`) — per `cities.active=true` market, ranks the week's top spots (most `check_ins` in last 7d, topped up with highest-`google_rating` active venues with deals), sends `weekly_digest` (props `cityName` + `spot1_name`/`spot1_deal` … up to 5, nested under `eventProperties`) to that city's subscribers = `profiles.city_slug = <slug>` with `digest_enabled` not false, emails resolved via the Supabase admin API. ⚠️ **Recipients are DB-driven off `profiles.city_slug`, NOT Loops.** No hardcoded slugs. Validates `CRON_SECRET` (or `?key=<service_role>`). Body lives in Loops. Returns `{success, cities[], recipients, sent, errors, perCity}`.

### Payments
- `POST /api/stripe-checkout` — creates Stripe customer + Checkout session for `STRIPE_PRO_PRICE_ID` (mode `subscription`). Verifies venue ownership via user JWT + RLS.
- `POST /api/stripe-billing-portal` — Customer Portal session.
- `POST /api/stripe-webhook` — handles `checkout.session.completed`, `customer.subscription.{updated,deleted}`, `invoice.payment_{failed,succeeded}`. HMAC-SHA256 signature verified via Web Crypto.

### Push (both **Node runtime** — APNs needs HTTP/2; shared sender in `api/_lib/apns.js`)
- `POST /api/send-push` — instant sends. APNs ES256 JWT via `node:crypto` (cached ~40 min at module level), delivery via one `node:http2` session per batch. `diagnose: true` in the body returns env/JWT info (+ `runtime`/`node_version`) without sending. Response `{sent, total, errors}` (admin.html depends on this shape) + `hint` when ALL tokens get production `BadDeviceToken` (= sandbox-issued tokens; check `ios/App/App/App.entitlements` aps-environment). Auto-deletes tokens APNs rejects with 410 Unregistered / 400 BadDeviceToken. Web push inert (web rows pre-filtered out of the token query). Auth: `Authorization: Bearer ${PUSH_API_KEY}` (also used by Postgres `pg_net` triggers). **Always call via `https://www.spotd.biz`** — the apex redirect strips the Authorization header.
- `GET|POST /api/push-runner` (cron, every 15 min) — Push Center engine. Mode A processes due `push_campaigns` (status=scheduled, send_at<=now; recurring campaigns get `send_at` advanced via an inline 5-field UTC cron parser instead of completing). Mode B evaluates enabled `push_automations` (`inactive_days`, `first_favorite`, `going_tonight_threshold`, `new_venue_in_city`) with `{{venue_name}}/{{city}}/{{count}}` templates, per-automation cooldowns enforced via `push_automation_log` (only successful deliveries are logged), 500 sends/automation/run cap. Audience jsonb: `{type:'all'|'user_ids'|'city_slug'|'platform', ...}`. Auth: `Bearer ${PUSH_API_KEY}` OR `Bearer ${CRON_SECRET}` (Vercel Cron) OR `?key=<service_role>`. `?mode=campaigns|automations` runs one mode.

### Admin-only (not routed by name)
- `POST /api/run-migration` — **Node runtime**, uses `pg`. Auth: `Bearer ${SUPABASE_SERVICE_KEY}`. Raw SQL executor.

### Crons (`vercel.json` `crons`)
- `/api/loops-inactive` daily `0 14 * * *` UTC
- `/api/daily-deals` daily `0 14 * * *` UTC
- `/api/weekly-digest` weekly Thu `0 15 * * 4` UTC
- `/api/push-runner` every 15 min `*/15 * * * *` (Push Center scheduler + automations)

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
| `inactive_7d`             | `api/loops-inactive.js` (cron)                       |
| `inactive_30d`            | `api/loops-inactive.js` (cron)                       |
| `daily_deals`             | `api/daily-deals.js` (cron)                          |
| `weekly_digest`           | `api/weekly-digest.js` (cron, Thu)                   |

**Loops contact custom properties (canonical names — reuse, don't near-dupe):** `city_slug` (slug), `cityName` (display), `vibes` (comma-separated vibe ids), `platform` (`ios`/`web`), `sourceDetail` (attribution source), `userGroup` (`new-signup` at signup → `activated` on first check-in). Written at signup via `/api/loops-onboarding` and updated via `/api/loops-update-contact`.

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
- `venues` — uuid PK, city_slug, name, neighborhood, address, lat, lng, hours, days[], cuisine, deals[], promo_code, promo_description, photo_url, photo_urls[], phone, place_id, url, google_rating, yelp_rating, yelp_review_count, price_level, owner_id, owner_verified, stripe_customer_id, stripe_subscription_id, subscription_tier (`free`/`pro`/`founding`), subscription_status, subscription_current_period_end, amenity booleans (`has_happy_hour`, `has_live_music`, `has_trivia`, `has_karaoke`, `has_sports_tv`, `is_dog_friendly`, `has_bingo`, `has_comedy`), per-amenity detail cols (`trivia_days/_time/_description`, `live_music_*`, `karaoke_*`, `bingo_*`), `description`, `is_hero`, active, featured. **Field conventions: `hours` = general operating hours (e.g. `Mon–Fri 11am–9pm · Sat–Sun 10am–10pm`). Happy hour time windows belong in `deals[]` as the leading entry (e.g. `"Happy hour Mon–Fri 3pm–6pm"`). `days[]` = days when happy hour runs. Do NOT put HH windows in `hours`.** **⚠️ There is NO `hours_start`, `hours_end`, or `is_official` column on `venues`** (an earlier version of this list wrongly claimed there was — naming them in a PostgREST `select` 400s the whole query and zeroes the venue list; see 2026-06-05 outage). `events` has NO `deals`/`photo_url`/`photo_urls`. When writing an explicit `select(...)`, every column must exist or PostgREST drops all rows.
- `events` — similar shape, with `event_type` (Trivia, Live Music, Karaoke, Bingo, Game Night, Comedy).

**User core**
- `profiles` — id (auth.users FK), display_name, digest_enabled, **`last_seen`**, **`referred_by`**, is_official, **`reengaged_7d_at`** / **`reengaged_30d_at`** (timestamptz, set by `api/loops-inactive` after sending each re-engagement cohort; `sql/loops-reengagement.sql`), **`city_slug`** (text, NOT NULL default `'san-diego'`; `sql/profiles-city-slug.sql`, backfilled to each user's most-frequent `check_ins.city_slug`). The digest crons fan out per active city off `profiles.city_slug`; onboarding writes the chosen city via `_persistSignupCity()` in `js/db.js`. `last_seen` heartbeat fires force-past-throttle on every authenticated session start (`_updateLastSeen(true)` in `initAuth`).
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
- `push_campaigns` (`sql/push_center.sql`, applied via MCP 2026-06-12) — title, body, url, audience (jsonb `{type:'all'|'user_ids'|'city_slug'|'platform',...}`), status (`draft`/`scheduled`/`sent`/`canceled`), send_at, recurrence (5-field UTC cron expr or null), sent_at, result (jsonb `{sent,total,errors}`). RLS enabled, NO policies = service-role only.
- `push_automations` (same file) — name, enabled, trigger_type (`inactive_days`/`first_favorite`/`going_tonight_threshold`/`new_venue_in_city`), trigger_config (jsonb e.g. `{days:7}`/`{threshold:2}`), template_title/template_body (`{{venue_name}}`/`{{city}}`/`{{count}}` placeholders), url, cooldown_hours (default 72). RLS, no policies.
- `push_automation_log` (same file) — automation_id (FK cascade), user_id, sent_at. Enforces per-user cooldowns + powers per-automation stats. RLS, no policies.

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

(`api/_lib/apns.js` + `api/push-runner.js` accept either pair, bare convention first.)

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
- Admin extension scripts live at **repo root** (NOT inside `admin/`): `admin-attribution.js`, `admin-claims.js`, `admin-enrichment.js`, `admin-giveaway.js`, `admin-push-center.js`.
- `admin/` subdirectory holds full HTML pages: `admin/board.html`, `admin/giveaway.html`.

---

## Push notification pipeline

- APNs via `node:http2` + `node:crypto` in `api/_lib/apns.js` (no SDK). **Node
  runtime, not Edge** — APNs is HTTP/2-only; the Edge runtime's fetch can't
  negotiate it, which is why every send failed with "Network connection lost"
  until the 2026-06-12 conversion.
- DB → `pg_net` → `POST https://www.spotd.biz/api/send-push` with
  `Bearer ${PUSH_API_KEY}`. **Always www** — the apex 308 strips Authorization.
- Triggered from:
  - `on_venue_activated` trigger on `venues` (inert unless
    `app.settings.push_api_key` is set at DB level — it currently isn't)
  - `happy-hour-reminder` pg_cron (11 PM UTC = 4 PM PT) — daily broadcast.
    Redundant once a recurring Push Center campaign replaces it (it lives in
    the DB, not code — unschedule via `select cron.unschedule('happy-hour-reminder')`).
  - `trg_notify_on_tag` via `send_push_to_user()` Postgres function
  - Admin **Push Center** tab: instant sends, scheduled/recurring campaigns,
    behavior automations (UI in `admin-push-center.js`, engine in
    `/api/push-runner` on a 15-min Vercel cron)
- Audience filter: includes "Just Me" option for self-testing (PR #73dcfaf).
- Dead tokens (APNs 410 Unregistered / 400 BadDeviceToken) are auto-deleted
  from `push_tokens` after each send.
- If production APNs rejects ALL tokens with `BadDeviceToken`: the tokens were
  issued by the sandbox env — check `ios/App/App/App.entitlements`
  `aps-environment` (says `development`; the App Store export normally flips
  it to `production`). `send-push` returns a `hint` field for this case.

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
9. **Author byline — use a random editorial alias, NEVER "Shane".** Pick one name from the editorial pool and use it consistently in all three places for that post: the article `<span>By X</span>` byline + `.blog-author-name`/`.blog-author-avatar` (initial) card, the `blog.html` grid card `<span>By X</span>`, and the `author:` field in `NEWS_ARTICLES`. The JSON-LD `author.name` stays `"Spotd"` (org-level, don't put a person there). Current pool: **Alexis, Ryan, John, Maya, Carlos, Priya, Diego, Sofia, Jordan, Emma, Tyler, Nina, Marcus, Olivia** — add new ones freely; the persona is "Spotd Editorial".
10. **Bump cache** — Increment `?v=` query string on `js/app.js` import in `index.html`.

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

- 2026-06-12 · **App-wide sliding highlight on segmented tab controls (same glide as the nav).** Extended the nav's sliding-capsule idea to every segmented control: social sub-tabs (`.social-sub-tabs-inner`, Following/Public/Trending), profile tabs (`.pf-tabs-inner`, Check-ins/Reviews/Saved/Lists/Tagged — scrollable), friend leaderboard (`.pf-lb-tabs`), and saved subtabs (`.pf-saved-subtabs`, Spots/Posts). **Generic, zero-touch mechanism** (`js/app.js`): `initSegSliders()` (called once in `DOMContentLoaded`) mounts a frosted `.seg-pill` into each control matching `SEG_SELECTORS` and sets up two observers — a body-level `MutationObserver` that auto-mounts controls as future renders create them (profile/leaderboard rebuild their innerHTML on switch), and a per-control `MutationObserver` watching child `class` attributes that re-glides the pill whenever the active class (`.active` or `.on`) moves. `_moveSegPill()` positions via the active child's `offsetLeft/Top/Width/Height` (relative to the `position:relative` container's padding box; the pill lives inside the scroller so it tracks the profile tabs' horizontal scroll for free). **The existing tab-switch handlers were NOT modified** — they still just toggle the active class; the observer does the rest. CSS (`css/style.css`): new `.seg-host`/`.seg-pill` (spring `cubic-bezier(.34,1.5,.5,1)`, `prefers-reduced-motion` → opacity fade); the static `.active`/`.on` backgrounds were stripped from all four controls so the pill is the only highlight (kept the active text color/weight). Pill look: soft `var(--bg2)` 16px for social/profile, white 999px for leaderboard/saved (white in both themes, matching the prior `.on`). **Pattern for any FUTURE segmented control: add its inner container to `SEG_SELECTORS`, remove its static `.on`/`.active` background, done — no per-control JS.** (Dead `.cp-tabs` composer control skipped — unused since the composer was unified.) Verified all four at rest / mid-glide / settled in light + dark via headless Chromium. Bumped `style.css?v=20260612c`, `app.js?v=20260612c`.
- 2026-06-12 · **Bottom nav: liquid-glass look + sliding highlight capsule (Instagram iOS-26 style).** Per a screen-recording reference (IG's frosted floating tab bar with a capsule that glides between tabs). Kept spotd's identity — text labels + the coral centre **+** post button stay. Two parts: (1) **Glass** — `.bottom-nav` (`css/style.css`) swapped its neumorphic `box-shadow`/`var(--card)` fill for translucent `rgba(255,255,255,0.66)` + `backdrop-filter: blur(22px) saturate(1.7)` (dark: `rgba(28,23,16,0.62)`), with an `@supports not (backdrop-filter)` fallback to solid `var(--card)`. (2) **Sliding capsule** — one absolutely-positioned `.bn-pill` (frosted rounded pill, `z-index:0`, buttons lifted to `z-index:1`) added as the first child of the nav in `ensureBottomNav()` (`js/app.js`). New `_moveNavPill(btn, animate=true)` measures the active button's rect relative to the bar and sets the pill's `width`/`height`/`translate()`; it's called from `_setActiveNavBtn()` (glides on every tab switch via a spring `cubic-bezier(.34,1.5,.5,1)` transition on transform/width/height), from the end of `ensureBottomNav` (rAF, `animate=false` snap on first paint), and from the window `resize` handler (snap). The pill measures geometry so it skips the centre **+** button automatically. Removed the old per-button active backgrounds (the `.bottom-nav-btn.active` gradient + the `.bottom-nav-btn.active::before` pop-in pill / `navPillIn` keyframes) — the single moving capsule replaces both. `prefers-reduced-motion` collapses the glide to an opacity fade. **Verified** in headless Chromium (Playwright, `--ignore-certificate-errors`) over a striped content background at 393×3 — glass blur visible, capsule positions under the active tab and glides cleanly to Profile past the **+**, both light + dark. Bumped `style.css?v=20260612b`, `app.js?v=20260612b`.
- 2026-06-12 · **GA4 funnel instrumentation fixed + extended (onboarding/auth).** Root cause of "15 onboarding_completed, 0 signups": the auth wall's "Skip for now — browse as guest" button was the ONLY caller of `obComplete()`, which fired `onboarding_completed` — so every "completion" was actually a guest skip (`obSkip()` itself was dead code with zero callers). **New semantics (`js/onboarding.js`):** `_obFinalize()` owns the OB_KEY flag + dismissal with NO analytics; `onboarding_completed {last_screen}` now fires exactly once in `obGoTo` when the final screen (auth wall, idx 7) is reached; the guest button calls new `obGuestSkip()` → `guest_skip {context:'onboarding'}` + `onboarding_skipped {from_screen}` + finalize. Added `onboarding_started` (once, in `obInit`) and `onboarding_screen_viewed {screen}` (per screen change, deduped) for per-screen drop-off. **Auth funnel:** `openAuth(mode, context)` gained a 2nd param and fires `auth_sheet_shown {context}` on every open (contexts: landing/onboarding/profile/checkin/favorite/follow/social/composer/messages/referral/giveaway/review/venue, default 'other' — ~20 call sites tagged, rest default); `auth_method_clicked {method:'apple'|'google'|'email'}` fires in `doAppleSignIn`/`doGoogleSignIn` (covers onboarding's `obDoApple`/`obDoGoogle` which delegate), `doAuth`, and `obDoEmailSignup`; `guest_skip {context:'landing'}` on the homepage "Continue without an account" button; `login_completed {method}` fires ALONGSIDE (never instead of) the legacy `login` (email signin, `doAuth`) and `oauth_login` (`handleOAuthCallback` in db.js) events — legacy event names untouched for GA continuity. **Platform dimension:** `track()` (`js/db.js`) now auto-appends `platform: 'ios_app'|'web'` to every event via `_trackPlatform()` (checks `window.Capacitor.isNativePlatform()`, `window.spotdNative`, `capacitor:` protocol — computed per call since the bridge injects late; overrides any caller-supplied `platform`). ⚠️ **GA-in-iOS-shell unverified:** the iOS project is NOT in this repo, so whether gtag.js actually transmits from the native shell couldn't be confirmed — the `platform` dimension doubles as the probe: if `platform=ios_app` events show in GA Realtime after the next app session it works; if not, fix = check the Capacitor `server.url` config (remote www origin → fine), else gtag `client_storage:'none'` + persisted `client_id`, or a Measurement Protocol relay edge function. GA4 custom dimensions to register: `context`, `screen`, `method`, `platform`. Bumped `db.js`/`onboarding.js`/`app.js` `?v=20260612a`.
- 2026-06-12 · **Push notifications fixed (Node/HTTP2 conversion) + Push Center (scheduling & automations).** Two root causes had broken ALL pushes for ~3 months: (a) pg_cron/triggers called bare `spotd.biz` → the apex 308 strips the `Authorization` header → silent 401s (Shane already repointed the pg_cron job at www; this session fixed the `notify_new_venue` DB function fallback via MCP migration + `sql/push_triggers.sql`); (b) `api/send-push.js` ran on the Edge runtime whose fetch can't speak HTTP/2 to APNs → every send died with "Network connection lost". **Fix:** converted `send-push` to a **Node serverless function**; APNs delivery now lives in shared `api/_lib/apns.js` (`node:http2` one-session-per-batch, `node:crypto` ES256 JWT cached ~40 min, per-token APNs `reason` strings in errors, auto-delete of 410/BadDeviceToken rows, all-BadDeviceToken→sandbox-entitlements `hint`). Response shape `{sent,total,errors}` and `diagnose` mode preserved (+ `runtime`/`node_version`); old inert Edge VAPID web-push code removed. **Push Center (Prompt 2):** new tables `push_campaigns`/`push_automations`/`push_automation_log` (`sql/push_center.sql`, applied via MCP, RLS no-policies = service-role only); new `api/push-runner.js` (Node) on a `*/15 * * * *` Vercel cron — processes due/recurring campaigns (inline 5-field UTC cron parser advances `send_at`) and evaluates 4 automation trigger types with `{{venue_name}}/{{city}}/{{count}}` templates + per-user cooldowns (only successful deliveries logged); auth = PUSH_API_KEY / CRON_SECRET / `?key=`. Admin UI shipped as the 5th extension script **`admin-push-center.js`** (NOT an admin.html edit — that file is fetched from `main` at serve time, so branch edits to it never deploy): augments `#page-push` with a "Schedule for later" block (datetime + daily/weekly repeat + audience incl. city slug), Scheduled Campaigns list w/ cancel, Automations CRUD w/ pause + sent counts, and overrides `renderPushHistory` to merge localStorage manual sends with DB campaign results (expandable per-token errors). The DB-side `happy-hour-reminder` pg_cron becomes redundant once a recurring campaign replaces it (left in place). ⚠️ Watch after deploy: if production APNs returns BadDeviceToken for all tokens, flip `aps-environment` to `production` in the App Store export.
- 2026-06-11 · **Nightly run: LCP `fetchpriority="high"` + blog post Costa Mesa.** (1) **Track 1 — LCP image priority:** added `fetchpriority="high"` to the first hero card image (`heroCardHTML`, `idx===0`) and to the first standard card in two-pane mode (`standardCardHTML` gained a `first=false` param; the two-pane `venues.forEach` now passes `i===0`). Also upgraded the first two-pane card from `loading="lazy"` → `loading="eager"` since lazy-loading the LCP candidate on desktop was actively harming the metric. Both changes are attribute-only, no logic change. `fetchpriority` is a well-known LCP hint that tells the browser to preload the candidate image above competing resources; industry benchmarks show 50–150ms LCP improvement. Bumped `app.js?v=20260611a`. Merged to main (low risk, confined to card renderers). (2) **Track 3 — Blog:** Added `blog/best-happy-hours-costa-mesa.html` (OC, keyword "best happy hours Costa Mesa"). Venues: Ospi (Aperitivo daily 3–6pm), Playa Mesa (M–F 3–6pm, Yelp best margarita in California), Descanso (M–F 3–6pm, $5 beers/$9 margs), Cafe Sevilla (Wed–Sun 5–7pm, 50% off all 26 tapas, all-night Wed/Thu), Yard House (M–F 3–6pm + late night Sun–Wed 10pm–close). All verified via Yelp/official sites June 2026. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `app.js`. Author: Sofia. Unsplash `photo-1567521464027-f127ff144326` verified 200.
- 2026-06-10 · **Satellite-page CX pass: new About page, real legal URLs, GA property unified, fixed a `main` CSS leak that was mangling the SSR SEO pages.** Follow-up to the desktop revamp after a More-menu destination audit. (1) **New `about.html`** — static About Us page (blog-nav + blog-footer pattern from `css/blog.css`, own inline styles, `AboutPage`/`Organization` JSON-LD, www canonical, GA tag). Brand-level voice ("small independent team" — no founder names, consistent with the blog alias rule). Wired into: the desktop More menu (top item), landing `btf-footer-discover`, `blog.html` nav, `sitemap.xml`, the footers of `api/spots-directory.js` / `api/happy-hour.js` / `api/spots.js` / `api/blog-post.js`, and `privacy.html`/`terms.html` footers (which also gained Blog links). (2) **Privacy/Terms now link to the real `/privacy.html` + `/terms.html`** from the More menu and the landing footer (unique URLs, logo-home nav) instead of the URL-less `openLegalPage` overlay; **the overlay stays for mid-flow contexts** (auth wall, onboarding consent, profile settings — `js/app.js` callers untouched) where navigating away would lose state. (3) **GA unified:** the 3 SSR edge renderers (`spots.js`, `spots-directory.js`, `happy-hour.js`) were the ONLY pages sending to `G-9PXGE6LEPE`; everything else (app, blog, business, legal) uses **`G-5271Q2407Q`** — so SEO-page traffic was landing in a property nobody looks at. All three switched to `G-5271Q2407Q`; vendor table corrected. (4) **CRITICAL pre-existing bug found & fixed:** the two-pane block's bare `main { display:flex; … }` selector (`css/style.css` ≥1200px) leaked into every page that loads `style.css` and has a `<main>` — `blog.html`, `/spots`, `/happy-hour/*`, `/spots/<slug>` — flexing their content into squeezed side-by-side columns on desktop (live `/happy-hour/san-diego` rendered as a mangled 4-column squeeze). Scoped to `.app-page main`. **Rule: never add bare-element selectors to the desktop blocks — `style.css` is shared by the SSR/blog pages.** Verified in headless Chromium: about page (block, 720px column, desktop+mobile), app two-pane intact (flex, 460px list, 440 cards, zero errors), live `/spots` + `/happy-hour/san-diego` re-rendered with the patched CSS via route interception → clean single-column. Bumped `style.css?v=20260610d`.
- 2026-06-10 · **Desktop revamp: slim one-line header, "More" nav menu, returning guests skip the city-selector landing.** Three changes for the desktop site (all inside the existing two desktop CSS blocks + small JS; mobile rendering unchanged). (1) **Single-line search/filter header (≥1024px):** `.controls` becomes `display:flex;flex-wrap:wrap` so its stacked children flow onto ONE line — `[search] [Filters] [suggested chips →]`; the active-filter `.chips-row` gets `order:5` + `flex-basis:100%` (+ `display:none` when `:empty`) so it only takes a line when filters are applied; the giveaway banner keeps `flex-basis:100%`. The verbose "Personalize Your Search" label swaps to "Filters" via two spans in the button (`.ft-label--long`/`.ft-label--short`; base rule near `.desktop-nav{display:none}` hides the short one, the ≥1024 block swaps). `#filterPanel` becomes a left-anchored 640px dropdown card (was a viewport-wide sheet) with amenity pills wrapping (`.fp-amenity-scroll{flex-wrap:wrap}`). Header now ends ~122px from the top (was ~290) → about one extra card row above the fold. (2) **"More" dropdown in the desktop nav** (`#desktopMoreWrap` in `index.html`, `toggleDesktopMoreMenu()` in `js/app.js` mirroring `toggleCityDropdown`'s outside-click pattern): Blog, For Business, `/spots` directory, both `/happy-hour/<city>` pages, Privacy/Terms (via `openLegalPage`), Support — previously only reachable from the landing-page footer, i.e. unreachable once inside the app. (3) **Desktop returning guests auto-enter their last city:** in `DOMContentLoaded` (`js/app.js`), a signed-out visitor at ≥1024px with a stored active `spotd-last-city` goes straight into the app — the city pill handles switching, so the selector landing was a speed bump. First-time visitors (no stored city) and all mobile users still get the landing + onboarding funnel; signed-in users already auto-entered. Also fixed while here: `_navBtns()` now includes `.desktop-nav-btn` so desktop tab switches clear the previous button's `.active` (it used to accumulate), and `bottomNavFeed` also scrolls `#listView` to top (the two-pane scroller). **Verified in headless Chromium against live Supabase data** at 1440/1100/1024/390px (auto-enter, one-line header geometry, filter dropdown, More menu → legal overlay, first-visit landing intact, mobile unchanged, zero page errors). **Env note: Playwright Chromium DOES work here if launched with `--ignore-certificate-errors` + context `ignore_https_errors=True` — the sandbox's TLS interception otherwise kills every CDN/Supabase load (`ERR_CERT_AUTHORITY_INVALID`), which is why earlier sessions thought headless verification was impossible.** Bumped `style.css?v=20260610c`, `app.js?v=20260610c`.
- 2026-06-09 · **Social tab motion smoothing — killed the per-card render jank.** Reported as "every button / tab switch is glitchy." Root causes were animations that **replayed on every render** (the feed fully re-renders on load / refresh / tab switch — `renderSocialTab` / `renderTrendingTab` rebuild `#socialFeedContent.innerHTML`). Fixes (`css/style.css` + `js/app.js`): (1) **Per-card entrance stagger removed.** `.sf-hero` / `.sf-compact` / `.sf-wide` each had `animation: sfFadeIn .35s … both` (translateY(16px) pop), so switching Following↔Public↔Trending replayed ~60 staggered card pops = the dominant glitch. Replaced with ONE cohesive container fade: new `@keyframes sfFeedEnter` (opacity + 7px rise) on `.social-feed-content.sf-feed-enter`, re-triggered by `_feedEnter(container)` (`js/app.js`) which toggles the class with a forced reflow (`void container.offsetWidth`). Called at every render exit in `renderSocialTab` (full + both empty states) and `renderTrendingTab` (content + empty). (2) **heartPop replay fixed.** `heartPop` was keyed off `.sf-action-btn.sf-liked svg`, and `.sf-liked` is present in the rendered HTML for already-liked posts → every liked heart re-popped on each render. Moved the trigger to a **runtime-only `.heart-bounce` class** (added in `doToggleLike` with a reflow on the like branch, cleared on unlike) so the pop only fires on an actual tap. `.imv-rail-btn.on` left as-is (separate surface). (3) **`transition: all` → scoped** on `.sf-action-btn` (was transitioning layout when the heart `innerHTML` swapped). (4) **Sub-tab press** got spring transform + `:active scale(.95)` (was a hard `opacity:.7`). (5) **Tab open fade:** `.social-tab.tab-open` now runs a `socialTabIn` .2s opacity fade so opening the tab isn't an instant snap. Save/comment buttons already mutate in place (no full re-render) so they were left alone. `sfFadeIn` keyframe kept (now unused, harmless). Bumped `style.css?v=20260609i`, `app.js?v=20260609i`. **Not verifiable headless** — needs a real-device check that tab switches crossfade cleanly, liked hearts no longer bounce on switch, and the pull-to-refresh (shipped earlier today) still works.
- 2026-06-09 · **Social feed header: dropped the + and refresh icons, added pull-to-refresh, enlarged the 3 remaining actions.** The social-feed header (`.social-header-right` in `index.html`) had 5 bare glyph buttons (Messages / Find people / Notifications / **+ Add a spot** / **Refresh**). Removed the last two: **Refresh** is replaced by **pull-to-refresh**, and the **+** ("Add a spot" venue-request form) was dropped entirely per Shane — the homepage already has a request-a-venue feature, so `openAddSpotForm()` (`js/app.js:426`) is now **unreferenced dead code** (left in place, harmless). The 3 remaining icons (`.social-refresh-btn`) went from flat 38px transparent circles to **44px soft-tinted circles** (`background:var(--ink-06)`, `:hover`→coral, gap 2px→8px, SVGs 18→21px) so they read as inviting tap targets. **Pull-to-refresh:** new `#socialPtr` indicator (`.social-ptr*` CSS, a `var(--card)` circle with the recycle glyph) sits absolutely between the sub-tabs and `#socialFeedContent`; `initSocialPullToRefresh()` (`js/app.js`, called once from `openSocialTab`, idempotent via `scroller._ptrBound`) binds touch handlers to the `#socialFeedContent` scroller — only arms when `scrollTop===0`, rubber-bands the pull (`dy*0.5`, max 96px), rotates the icon with progress, and on release past the 64px threshold adds `.social-ptr--spin` + calls `loadSocialFeed({force:true})` (resets `_socialLoading=false` first, same as the old refresh button). `touchmove` is `passive:false` so it can `preventDefault()` the native overscroll bounce once pulling. Bumped `style.css?v=20260609h`, `app.js?v=20260609h`. **Not verifiable headless** (no Chromium here) — needs a real-device check of the pull gesture + the resized header icons.
- 2026-06-09 · **Messages: signature coral→amber gradient + transition/keyboard polish (from a screen-recording review).** (1) **Gradient:** your own message bubbles (`.dm-msg--mine .dm-bubble`), the round send button (`.dm-send-btn`, which the "Start Chat"/"Create Group" `--text` variant inherits), and the share-to-DM send button (`.dm-share-send-btn`) were a flat coral→dark-red (`--teal,--teal-dk` / hardcoded `#FF6B4A,#FF8559`). Switched all three to the app's signature **`linear-gradient(135deg, var(--coral), var(--amber))`** — the exact warm gradient on the check-in CTA (`.modal-checkin-cta`), the "+" nav FAB (`.bottom-nav-post`), save buttons, day pills, etc. (`--coral`=#FF6B4A, `--amber`=#E8943A light / #F59E0B dark, so it adapts per theme). Incoming bubbles stay neutral card (standard chat contrast). (2) **Inbox blank flash:** `dmLoadInbox` blanked the list to "Loading…" on every call, so backing out of a convo flashed an empty inbox before the (cached) rows re-rendered — now only shows the placeholder on a cold load (`!list.querySelector('.dm-thread-row')`), else refreshes in place. (3) **Keyboard cream gap:** when the keyboard was up, the compose bar's `calc(14px+safe-area)` bottom padding floated the input above a visible cream strip — `dmSyncViewport` now toggles a `.dm-tab--kb` class while the keyboard is open and CSS collapses the compose padding to `10px` (removed on focusout/close). (4) **Entry animation:** softened `dmScreenSlide` from a `translateX(14px)` sideways slide to a gentle `translateY(8px)` settle at `.2s` so it doesn't fight the keyboard's motion. **Frame extraction note:** no system `ffmpeg` in this env — `pip install imageio-ffmpeg` provides a static binary at `imageio_ffmpeg.get_ffmpeg_exe()` for pulling frames/contact-sheets from uploaded screen recordings. Bumped `style.css?v=20260609g`, `app.js?v=20260609g`.
- 2026-06-09 · **Group chat showed only "you" in the members bar + keyboard exposed the app behind the DM tab.** Two fixes (`js/app.js`). (1) **Members bar only-me:** reopening a group from the inbox calls `dmOpenConvo` without `knownMembers`, which loaded the members bar via a direct `db.from('conversation_participants').select('user_id').eq('conversation_id', …)`. But the `cp_select` RLS policy is `USING (user_id = auth.uid())` — a plain query returns ONLY your own participant row, so every group rendered as just "you" even though the rows exist (verified: the "Test" group has 3 real participant rows). Fixed by sourcing the members from the **`get_conversation_participants` RPC** (`SECURITY DEFINER`, `convo_ids uuid[]`) — the same RLS-bypassing path the inbox already uses — then fetching profiles for the returned ids. **Rule: to read *all* members of a conversation you're in, use the `get_conversation_participants` RPC, never a direct `conversation_participants` select (RLS limits it to your own row).** (2) **Keyboard bleed-through:** the prior `dmSyncViewport` lifted the fixed `inset:0` tab's `bottom` edge by the keyboard height, which shrank the element and exposed the app *behind* it during the keyboard open/close animation ("shows other parts of the app"). Switched to `padding-bottom` (global `box-sizing:border-box`, so the tab stays full-screen and the gap is the tab's own `var(--bg)` background, never the app). Reset `paddingBottom` on focusout/close. Bumped `app.js?v=20260609f`.
- 2026-06-09 · **Group chat: member avatar photo took over the whole chat (same `initialsAvatar` img bug class).** The group-chat **members bar** pill (`renderMembers` in `dmOpenConvo`, `js/app.js:7048`) dropped `initialsAvatar(...)` straight in as a direct child of `.dm-member-pill`. For a user with a real `avatar_url`, `initialsAvatar` returns `<img style="width:100%;height:100%">` — with no fixed-size parent the `width:100%` resolved against the pill's auto width and the photo blew up to fill the entire conversation (reported as "massive profile photo taking over the chat"). This is the **same failure mode** as the 2026-06-05 check-in chip (`.tag-friend-chip-avatar`) and the inbox row (`.dm-thread-avatar`, which was already safe). Fix: wrapped the avatar in a fixed `22×22` circular `.dm-member-avatar` frame (`overflow:hidden`) with `img{width:100%;height:100%;object-fit:cover}` so the inline `width:100%` resolves against 22px. **Rule reaffirmed: any place that renders `initialsAvatar(name, ..., avatar_url)` MUST put it inside a fixed-size container — it returns a `width:100%/height:100%` `<img>` for photo users and will expand to its parent.** Bumped `style.css?v=20260609e`, `app.js?v=20260609e`.

- 2026-06-09 · **Messages (DM) UX smoothness pass.** Fixed the "blank chat + nav bleeds over the conversation + jumpy keyboard" report. Root cause of the bleed-through: `.dm-tab` is `z-index:499` but `.bottom-nav` is `z-index:600`, so the global Discover/Explore/News/Profile bar floated *on top of* an open conversation (and the compose bar carried a `96px` bottom-padding hack to dodge it). The nav is *also* the only way to exit the **inbox** (tapping a nav button → `_navHideAll` → `closeDmTab`), so it can't be hidden everywhere. Fix: `dmShowScreen` now toggles a `.dm-tab--takeover` class (`z-index:620`, above the nav) on the **convo/picker** screens only — inbox stays at 499 so nav-exit still works; convo/picker become a clean full-screen takeover (exit via the back button). Dropped the `96px`/`72px` nav-dodge bottom-padding on `.dm-compose`/`.dm-picker-footer` → `calc(14px + safe-area)`. **Keyboard:** added `dmSyncViewport()` (`js/app.js`) bound to `visualViewport` resize/scroll + the `dmInput` focusin — lifts the fixed `inset:0` tab's `bottom` by the keyboard height so the compose bar rides just above the keyboard (no jump/hidden field); reset on focusout/close. Send button got `onmousedown="event.preventDefault()"` so it doesn't blur the input / dismiss the keyboard on each send. **Smoothness:** added `@keyframes dmScreenSlide`/`dmScreenFade` on `.dm-screen--flex`/`--scroll` (GPU opacity+translateX, replays on display none→flex) for a gentle slide-in instead of an instant blank swap; centered the `.dm-loading`/`.dm-empty` states in `.dm-messages` (`margin:auto`) and softened the empty copy to "No messages yet. Say hi! 👋" so a new/empty convo reads as intentional, not broken. Bumped `style.css?v=20260609d`, `app.js?v=20260609d`. **Behavior change to note:** from inside a conversation the global bottom nav is now covered (you back out to the inbox to switch app tabs) — matches standard chat UX. Not verifiable headless (no Chromium here) — needs a real-device check of: nav no longer over the chat, smooth screen entry, compose bar tracking the keyboard, and inbox-exit still working via the nav.

<!-- format:
- YYYY-MM-DD · <decision> — <why>. (PR or commit)
-->

- 2026-05-27 · Rewrote CLAUDE.md as the source of truth. Added a Stop hook
  (`.claude/hooks/stop-claude-md-check.sh`) that blocks turn-end if files
  changed but CLAUDE.md didn't, to enforce the "keep this file alive" meta rule.
- 2026-06-09 · **Per-city digests — both crons now route off `profiles.city_slug`, scalable to any market.** Added `profiles.city_slug` (text NOT NULL default `'san-diego'`, indexed; `sql/profiles-city-slug.sql`, applied) with a city-agnostic backfill = each user's most-frequent `check_ins.city_slug` (no-check-in users keep the SD default; today all 112 resolved to SD since all check-ins are SD). Onboarding now persists the chosen city: `_persistSignupCity()` (`js/db.js`) PATCHes `profiles.city_slug` from localStorage `spotd-last-city` after both the email-signup (`authSignUp`) and OAuth (`handleOAuthCallback`) session is established. Both crons (`weekly-digest`, `daily-deals`) dropped the `check_ins`-based recipient lookup (`engagedUserIds`/`digestDisabledSet`) for a single `cityRecipientIds(slug)` helper = `profiles?city_slug=eq.<slug>` filtered to `digest_enabled !== false` (paginated). `daily-deals` is now **per-city**: it groups deal venues by `city_slug` and picks/sends each active city's own 3 venues (was a single global pick); response gained `perCity:{slug:{venues,recipients,sent}}`. **No hardcoded city slugs in either cron's recipient logic** — everything keys off `cities.active=true`, so activating LA/NYC/etc. auto-enrolls their users with zero code change. Bumped `db.js?v=20260609b`.
- 2026-06-09 · **Loops `events/send` needs `eventProperties`, not top-level keys.** Both `daily-deals` + `weekly-digest` spread event data at the top level of the send body (`{email, eventName, ...props}`); Loops ignores unknown top-level keys, so the merge fields arrived empty. Fixed to nest under `eventProperties` (`{email, eventName, eventProperties: props}`). Same applies to any future `/events/send` call — properties go under `eventProperties`.
- 2026-06-09 · **`daily-deals` + `weekly-digest` sent 0 emails — Loops has no list-all-contacts endpoint.** Both crons sourced recipients via `GET https://app.loops.so/api/v1/contacts?limit=&offset=`, which doesn't exist (404s every run → "Loops contacts fetch failed" → empty recipient list → 200 with `sent:0`). And `profiles` has no city column, so a user's city can't be read there. **Fix:** source recipients from the DB instead. New shared helpers in both files — `engagedUserIds(slug)` (distinct `check_ins.user_id` for the city), `digestDisabledSet(ids)` (PostgREST `digest_enabled=is.false`), `resolveEmail(uid, cache)` (Supabase `/auth/v1/admin/users/{id}`, reusing the `loops-inactive` pattern, cached). `daily-deals` sends global props to the **union** of engaged users across all active cities; `weekly-digest` sends each city's props to that city's engaged users. Deleted the Loops `/contacts` pagination loop from both. Response shapes now report `recipients`/`sent`/`errors` (+ `perCity` for weekly-digest). Spot-ranking/deal logic unchanged. **Loops `/contacts` is NOT a list endpoint — never fan out to "all Loops contacts"; resolve recipients from Supabase.**
- 2026-06-09 · **Loops lifecycle build — signup enrichment, activation, fixed crons, weekly digest, onboarding copy.** (1) **Signup → Loops:** `_loopsSignupContext()` (`js/db.js`) gathers `city_slug`/`cityName`/`vibes`/`platform`/`sourceDetail` from `obState`/localStorage/sessionStorage; `triggerLoopsOnboarding` sends them and `api/loops-onboarding.js` writes them as top-level contact custom props (only when present), keeping `userGroup:'new-signup'` + 409 handling. (2) **Activation:** new `api/loops-update-contact.js` (edge, `contacts/update` PUT, mirrors `loops-event.js`); `markLoopsActivated()` flips `userGroup:'activated'` on first check-in in `_fireCheckinLoopsEvents`, guarded by localStorage `spotd-loops-activated`. (3) **Fixed dead crons:** both `loops-inactive`/`daily-deals` returned blank 500s. `loops-inactive` rewritten to use `coalesce(last_seen, created_at)` + "older than 7d/30d AND not already sent" (new `profiles.reengaged_7d_at`/`reengaged_30d_at`, `sql/loops-reengagement.sql`, applied) + explicit `console.error` on every failure + per-cohort manual-trigger counts; 30d cohort takes precedence. `daily-deals` was 500ing because its venue `select` named phantom `hours_start`/`hours_end` — switched to `venues.hours` and added explicit error logging. `_updateLastSeen(force)` now bypasses the hourly throttle on session start (`initAuth` calls `_updateLastSeen(true)`); migration also backfills `last_seen = coalesce(last_seen, created_at)`. (4) **Weekly digest:** new `api/weekly-digest.js` (edge) + `vercel.json` cron `0 15 * * 4`; ranks each active city's week by check-ins (fallback: top-rated active venues with deals) and sends `weekly_digest` per matching `city_slug` contact with `cityName` + up to 5 spot names/deals; body lives in Loops. (5) **Onboarding copy** (`index.html` + `js/onboarding.js`): new entry headline/sub, "47 people out right now" pill, fixed verbatim vibe title/sub (stopped the `OB_SCREEN2_HEADLINES` rotation), new "The fun part" social-preview step inserted before the auth wall (`totalScreens` 7→8, 8th progress dot, signup render hook moved to idx 7, new `.ob-social-*` CSS), and fixed auth-wall title "You're in. Let's make it yours." Routes added in `vercel.json` for `/api/loops-update-contact` + `/api/weekly-digest`. Bumped `db.js?v=20260609a`, `onboarding.js?v=20260609a`.
- 2026-06-06 · **Composer enrichment — friend tagging, clearer multi-photo, always-on Story, inviting design.** Built on the unified composer. (1) **Tag friends:** new `_composerOpenTagSheet` (bottom-sheet of followed friends as `.tag-friend-chip`s) + `_composerToggleTag` stage ids in `_composerTags` (Set); `submitComposer` captures the saved post (`saveCheckinPhoto`/`saveTextPost` now return the row) and calls `saveTagsForPost(post.id, [..._composerTags])` — real `post_tags` + notification (the `@`-mention in the body is still just text). Options row gained a `👥 Tag friends` / `👥 N tagged` chip. (2) **Multi-photo clarity:** photo tile now shows `Add photos` + `Up to 5 — they post as a swipeable gallery`, and `Add more · N left` once started (multi-photo already worked; this just surfaces it). (3) **Story is always selectable** (was hidden until a photo) so you can choose "just a Story"; submit still blocks a story with no photo. (4) **Inviting design:** `.cp-postingas` avatar+name header, a rotating `_composerPlaceholder` (COMPOSER_PLACEHOLDERS), one-tap idea chips on the blank state (`COMPOSER_IDEAS` → `_composerPrompt` prefills the caption), bigger `.cp-body--big`, warmer hint, dynamic Post label (`Post`/`Share`/`Share Story`). New CSS: `.cp-postingas*`, `.cp-ideas/.cp-idea`, `.cp-photo-pick-*`, `.cp-tagsheet-*`. Bumped `app.js?v=20260605m`, `style.css?v=20260605l`.
- 2026-06-06 · **Unified the post composer — removed the Status/Photo/Editorial mode tabs.** Was decision overload: users had to pick a mode upfront. Now `_renderComposerCompose` (`js/app.js`) is ONE form — caption textarea + always-available photo picker ("Add photos (optional)") + venue/visibility/story options — and `submitComposer` **infers the post type at submit**: photos present → `post_type:'photo'` (caption optional), text only → `saveTextPost` (`post_type:'text'`). **Editorial creation is gone** (the `is_official` "Editorial" tab, `cpTitle`/`cpPin`, and the editorial submit branch were removed); existing editorial posts still RENDER (pinned logic, `sf-editorial` variant, `saveEditorialPost` left defined but now unreferenced) — only the creation path was removed. Story (24h) is now a contextual option that shows once a photo is added (or when opened via the stories‑strip "+", which passes `{story:true}`); a story with no photo is blocked. Removed `_composerSwitchType`; the photo-editor router now keys off `_composerStep==='edit'` instead of `_composerType==='photo'` (so editing works without a "photo mode"). `_composerType` is now vestigial (set, never read). Header center reuses the existing `.cp-edit-title` style for a "New post" label; the `.cp-tabs`/`.cp-type-tab` CSS is now dead but harmless. Bumped `app.js?v=20260605l`.
- 2026-06-06 · **Admin "Last Seen" was mostly "Never" — flaky `last_seen` heartbeat.** `profiles.last_seen` was set on only 7 of 141 users (13 clearly-active users, some active that same day, showed "Never"). RLS was fine (`id = auth.uid()` self-update allowed); the bug was timing: `_updateLastSeen()` (`js/db.js`) runs synchronously in `initAuth` BEFORE the background token-refresh sets `_accessToken`, so returning users whose stored token had expired pinged with no token and bailed. Fixes (`js/db.js`): (1) call `_updateLastSeen()` at the end of `_refreshAndPersist` (every fresh token now pings), and (2) call it on `visibilitychange→visible` (the iOS WKWebView stays alive across backgrounding, so `initAuth` only runs once per launch — without this a daily returner pinged at most once). Both rely on the existing 1/hour localStorage throttle. One-time **backfill** (`sql/backfill-last-seen.sql`, applied via MCP — 15 rows) set `last_seen = greatest(last_seen, max(check_in/post/review created_at))` so the column is accurate now; the remaining 121 "Never" profiles genuinely have zero activity. This also improves the `loops-inactive` churn cron, which reads `last_seen`. Bumped `db.js?v=20260605j`.
- 2026-06-06 · **CRITICAL: tagging never actually saved — `post_tags` RLS rejected every insert.** The `post_tags` INSERT policy ("post owner tags others") is `WITH CHECK (tagged_by = auth.uid() AND EXISTS(checkin_photos where id=post_id and user_id=auth.uid()))`, but `saveTagsForPost` (`js/db.js`) inserted via the bare anon `db` client (no JWT → `auth.uid()` is null), so **every tag insert silently failed the policy** and the table was completely empty despite many tagging attempts. Fixed by building a token-carrying client from `getSession().access_token` (same pattern as `saveCheckinPhoto`) before the insert. **Any vanilla `db.from(...).insert/update/delete` on an RLS table that checks `auth.uid()` MUST use this authed-client pattern — the module-level `db` is anon-only.** Also: the immersive viewer (`_immersiveSlideHTML`) never rendered tags — added `_renderTaggedFriendsPill(item.tagged_friends)` to its info block (+ light `.imv-info .sf-tagged-*` CSS), and `openPublicProfile` now closes the viewer first so a tagged-name tap isn't hidden behind the photo. Tags created before this fix were never persisted, so they won't retroactively appear — re-tag to test. Bumped `db.js?v=20260605i`, `app.js?v=20260605k`, `style.css?v=20260605k`.
- 2026-06-06 · **Comments sheet now opens above the immersive viewer.** Tapping the 💬 rail button inside the full-screen photo viewer (`.imv`, `z-index:10000`) opened the comments sheet as a normal `.overlay` (`z-index:700`), so it was hidden behind the photo until you closed it. `openCommentsSheet` (`js/app.js`) now detects an open viewer (`#immersiveViewer.imv--open`) and adds `.overlay--above-imv` (`z-index:10050`, `css/style.css`) so the sheet stacks on top — you can read/post comments without leaving the photo (unlike the user/venue chips, which intentionally close the viewer). Bumped `app.js?v=20260605j`, `style.css?v=20260605j`.
- 2026-06-06 · **Killed the ugly "a spot" headline in the social feed.** A plain status post (a `checkin_photos` row with `post_type:'text'` and `venue_id = NULL` — e.g. someone typing a venue name as their status in the composer) rendered with `venueName`'s hardcoded `'a spot'` fallback as a bold headline, with the real caption shoved underneath. Two fixes: (1) `fetchSocialFeed` (`js/db.js`) now hydrates `venue_name`/`neighborhood` for photo/text posts from the `venues` table (extended the existing going-tonight venue fetch to include `photos` venue_ids), so a legitimately venue-linked post never falls back to "a spot" just because its venue isn't in the currently-loaded city. (2) `renderSocialItem` (`js/app.js`) drops the `'a spot'` fallback (now `''` + a `hasVenue` flag) and **only renders the venue line/headline when `hasVenue`** across the hero, compact, and wide variants; for a venue-less post the caption becomes the lead (compact uses new `.sf-compact-caption--lead` styling; wide drops the surrounding quotes). Bumped `db.js?v=20260605h`, `app.js?v=20260605i`, `style.css?v=20260605i`.
- 2026-06-05 · **Venue modal hero is now a swipeable photo gallery.** ~178 active venues have a `photo_urls` array (3–6 enrichment photos, `photo_url` = `photo_urls[0]`), but we only ever showed the one primary photo. `renderModal` (`js/app.js`) now renders the hero as a horizontal scroll-snap carousel (`.modal-hero-track` + `.modal-hero-slide` + top-center `.modal-hero-dots`) whenever `photos.length > 1`; single-photo venues are unchanged. Each slide taps through to the existing `openPhotoLightbox`. Dots track the active slide via `_syncModalDots(track)` wired inline on the track's `onscroll` (modal is re-rendered each open, so no post-render wiring pass needed). Mirrors the existing social-feed `sf-carousel` pattern. **Feed cards intentionally stay single-image** (tap → modal gallery) to avoid loading 3–6 images per card and swipe-vs-vertical-scroll friction with the overlay-heavy hero cards. New CSS in `css/style.css` under the `.modal-hero-*` block. Bumped `app.js?v=20260605h` + `style.css?v=20260605h`.
- 2026-06-05 · **HOTFIX: production showed "0 of 0 venues" in every city — bad explicit `select()`.** The 2026-06-05 nightly run rewrote `fetchVenues`/`fetchEvents` (`js/db.js`) from `select('*')` to an explicit column list built from this file's (inaccurate) schema notes. That list named columns that **do not exist** in the DB — `venues` has no `hours_start`/`hours_end`/`is_official`, `events` has no `deals`/`photo_url`/`photo_urls`. PostgREST rejects the entire query when a selected column is missing, so `data` came back null → `[]` → no venues/events loaded at all (the app shell still rendered, hence "No spots found"). Fixed by dropping the phantom columns from both selects (verified every remaining column against the live `information_schema` via Supabase MCP — venues query now returns all 499 SD rows). Corrected the `venues`/`events` schema lines above so this can't recur, and added the rule "every column in an explicit select must exist or PostgREST drops all rows." Bumped `db.js?v=20260605g`. **Lesson:** never trust CLAUDE.md's column list for a `select()` — verify against `information_schema`, or just use `select('*')`.
- 2026-06-05 · **Dropped "Shane" as the blog byline — every post now uses a random editorial alias.** Per founder request, no blog post should say "Shane" anymore. Assigned each of the 18 `blog/*.html` posts a fixed alias from an editorial pool (kept the Alexis/Ryan/John already in `NEWS_ARTICLES`, added Maya/Carlos/Priya/Diego/Sofia/Jordan/Emma/Tyler/Nina/Marcus/Olivia) and applied it consistently in three places per post: the article `By X` byline + `.blog-author-name`/`.blog-author-avatar` initial card, the `blog.html` grid card byline, and the `author:` field in `NEWS_ARTICLES` (`js/app.js`). JSON-LD `author.name` was already `"Spotd"` (org-level) and `article:author` meta `"Spotd"` — both left as-is. Did NOT touch non-blog "Shane" references (founder profile, CLAUDE.md, admin). Added a blog-checklist step (#9) so future posts always use an alias. Bumped `app.js?v=20260605f`.
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
- 2026-06-05 · **Nightly run: narrowed `fetchVenues` and `fetchEvents` select** in `js/db.js` from `select('*')` to an explicit field list. Excluded 8 columns never used in the client-side render path: `stripe_customer_id`, `stripe_subscription_id`, `subscription_current_period_end`, `subscription_tier`, `subscription_status`, `owner_id`, `place_id`, `price_level`. These were confirmed 0-reference in `js/app.js`. Effect: reduces JSON payload for the initial venue load (e.g. 498 SD venues) by removing ~200 chars/venue of null/unused fields, including the stripe key names even when null (~70-100KB uncompressed across both cities). Also prevents Stripe customer/subscription IDs from being sent to the browser. `photo_urls`, `address`, and all card/modal/search fields retained. Risk: low (additive exclusion of confirmed-unused columns). Bumped `app.js?v=20260605b`.
- 2026-06-05 · Added Laguna Beach neighborhood guide blog post (`blog/best-happy-hours-laguna-beach.html`). Keyword: "best happy hours Laguna Beach". Target city: Orange County (alternating from SD yesterday). Venues verified: The Cliff Restaurant (Yelp May 2026), Coyote Grill (Yelp March 2026), Mozambique (mozambiqueoc.com), Starfish (Yelp June 2026), Lumberyard (Yelp May 2026), Hennessey's Tavern (Yelp April 2026). Full SEO checklist applied: non-blocking fonts, Article JSON-LD with Unsplash image (w=1200), ISO 8601 dates, FAQPage JSON-LD (4 Q&As mirroring visible FAQ), .blog-related internal links, Yelp external links. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `js/app.js`. Bumped `app.js?v=20260605b`.
- 2026-06-05 · Social Handoff Notion page created: https://app.notion.com/p/37689936834b811e83bac9135e779636 — OC Laguna Beach "Spin the Bottle" picks carousel (Thu - BTS/Founder slot). Venues: The Cliff Restaurant, Coyote Grill, Mozambique, Starfish (all verified open tonight). Trend ridden: "Spin the Bottle" carousel format (no licensed audio, brand-safe for business accounts). Reddit r/orangecounty editorial post + X thread included. Skipped "Everything Hallelujah" (used June 3+4) and "Things That Just Make Sense" (used June 4).
- 2026-06-07 · **Nightly run: parallelized profiles + venues enrichment fetches in `fetchSocialFeed` (`js/db.js`).** The two sequential `await db.from('profiles')` + `await db.from('venues')` queries that enrich feed items after the initial 3-way parallel fetch were fully independent but ran serially — one extra DB round-trip (~50–150ms) on every social feed load. Collapsed them into a `Promise.all` so both fire simultaneously. Change is safe, confined to db.js enrichment logic, and zero schema risk. Bumped `db.js?v=20260607a` + `app.js?v=20260607a` (cache bump on app.js for NEWS_ARTICLES change in same commit).
- 2026-06-07 · Added East Village neighborhood guide blog post (`blog/best-happy-hours-east-village-san-diego.html`). Keyword: "best happy hours East Village San Diego". Target city: San Diego (alternating from OC on 2026-06-05). Venues verified: Villain's Brewing (2–6pm HH on non-event days, Yelp June 2026), Lola 55 (daily 4–6pm, MICHELIN Bib Gourmand, Yelp Feb 2026), Bay City Brewing East Village (M–Th 3–5pm 50% off drinks, F 3–5pm 50% off tab, Yelp May 2026), Cowboy Star (M–F 3–6pm $7 drafts/$8 wells/$9 wines/$10 cocktails, Yelp June 2026), Barleymash (M–F 3–6pm half off all alcohol, Yelp May 2026). Full SEO checklist applied: non-blocking fonts, Article JSON-LD with Unsplash image `photo-1572116469696-31de0f17cc34` (w=1200, **needs curl-verification — WebFetch unavailable in this remote env**), ISO 8601 dates with Pacific TZ, FAQPage JSON-LD (4 Q&As mirroring visible FAQ), .blog-related internal links, Yelp external links. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `js/app.js`. Social Handoff Notion page also created.
- 2026-06-09 · **Nightly run: lazy-load avatar images in `initialsAvatar` (`js/icons.js`).** The `initialsAvatar` helper (used in the social feed, reviews, comments, leaderboard, tag sheets) rendered `<img src="...">` without `loading="lazy" decoding="async"`. A social feed with 60 items has up to 60 eager avatar fetches at load time — all queued before any below-the-fold content is even considered for deferral. Added the two attributes to the `<img>` tag in `initialsAvatar`. Risk: low; `loading="lazy"` on in-viewport images causes no perceptible flash (browser loads them immediately). Bumped `icons.js?v=20260609a`, `app.js?v=20260609c`.
- 2026-06-09 · Added Huntington Beach neighborhood guide blog post (`blog/best-happy-hours-huntington-beach.html`). Keyword: "best happy hours Huntington Beach". Target city: Orange County (alternating from SD East Village on 2026-06-07). Venues from DB + web search: Perqs (117 Main St, $5 wells 4–7pm, confirmed via Yelp June 2026), Rockin' Fig ($4 beer 3–7pm), Main Street Bar & Grill ($4 draft 3–7pm), HQ Gastropub at Shorebreak Hotel (daily 3–6pm, cocktails + food), Old World Festival Hall ($2 off drinks Fri–Sun). Full SEO checklist applied: non-blocking fonts, Article + FAQPage JSON-LD (4 Q&As mirroring visible FAQ), ISO 8601 dates with Pacific TZ, blog-related internal links. Unsplash image `photo-1571019614242-c5c5dee9f50b` verified returning 200 via WebFetch. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `js/app.js`. Author: Marcus.
- 2026-06-04 · **SEO discovery + ranking build (Tasks 1–3).** Follow-up to the canonical-host fix (PR #188). GSC showed venue pages as "URL is unknown to Google / Referring page: None detected" — they were only reachable via the JS app + sitemap, so Googlebot had no crawl path. (1) **Discovery** — new `api/spots-directory.js` at `/spots`: a crawlable HTML index of all 665 indexable venues (active + `photo_url IS NOT NULL`, mirroring the sitemap), grouped by city with real `<a href="https://www.spotd.biz/spots/...">` links + `ItemList` JSON-LD. (2) **Ranking** — new `api/happy-hour.js` at `/happy-hour/<city>` + `/happy-hour/<city>/<neighborhood>`: SSR landing pages with unique data-driven copy (live counts, real venue names + deals pulled from Supabase), crawlable venue lists, day-filter chips (`?day=tuesday`, explicit-`days[]` matches only so day pages stay distinct), neighborhood chips, FAQ (visible + `FAQPage` JSON-LD mirrored per the blog rule), `ItemList` + `BreadcrumbList` JSON-LD, self-canonical (incl. `?day=`). Generic over any city with photo'd venues (SD 495 / OC 170 today). (3) **Internal linking** — added crawlable footer links to `/spots` + city/neighborhood pages on the homepage (`index.html`, new `.btf-footer-discover`, bumped `style.css?v=20260604d`), venue footer (`api/spots.js`), blog footer (`api/blog-post.js`), and a "Browse happy hours by area" block in `blog/best-happy-hours-san-diego.html`. Wired routes in `vercel.json` (`/spots` exact BEFORE `/spots/(.+)`; two-segment `/happy-hour` before one-segment; `/sitemap-cities.xml`). Added `/spots` + both city pages to static `sitemap.xml`; new dynamic `api/sitemap-cities.js`; updated `robots.txt` (Allow `/happy-hour/`, added `sitemap-cities.xml`, fixed venues sitemap line to `/sitemap-venues.xml`). Verified all handlers render via stubbed-fetch harness (200s, correct anchor counts, www canonicals, no apex leaks, all JSON-LD blocks parse; Tuesday filter correctly drops empty-`days` venues). **Manual GSC follow-up after deploy:** submit `sitemap-cities.xml`, Request Indexing for `/spots` + `/happy-hour/san-diego` (high-value crawl entry points). **Backlog:** the day-page copy could be deepened; consider a `/happy-hour/orange-county` neighborhood link set in the OC blog post; non-launched cities (LA/NYC/etc.) have photoless venues so they correctly stay out of `/spots` and the city pages 404.
- 2026-06-10 · **Nightly run: added `defer` to all 7 app scripts in `index.html` for parallel downloads.** Scripts at end of `<body>` without `defer` download and execute one at a time (blocking HTML parser between each). Adding `defer` allows all 7 to download in parallel (alongside each other and the rest of the page) while still executing in DOM order — same execution guarantees, ~300–600ms faster on mobile. Scripts affected: `@supabase/supabase-js@2` (CDN), `js/db.js`, `js/onboarding.js`, `js/push.js`, `js/icons.js`, `js/app.js`, `js/tooltips.js`. Safe because: (1) all inline `onclick` handlers call functions that run post-load (user interaction can't precede DOM+script load); (2) no `document.write()` in any deferred script; (3) execution order preserved (supabase-js → db.js → app.js chain intact). Consistent with the Leaflet `defer` already on lines 100–101. Bumped `app.js?v=20260610a`.
- 2026-06-10 · **Blog: added Ocean Beach, San Diego neighborhood happy hour guide** (`blog/best-happy-hours-ocean-beach-san-diego.html`). Keyword: "Ocean Beach happy hour / best bars Ocean Beach San Diego". Target city: San Diego (alternating from OC HB on 2026-06-09). Venues: Raglan Public House (Mon–Fri 3–6pm, $6 drafts/wine/cocktails), Wonderland Ocean Pub (daily 3–5pm, $5 drafts, ocean views), Ocean Beach Brewery (daily 3–6pm, $3 off drafts), The Holding Company (daily 4–6pm, $4 wells, live music), La Doña (daily 2–5pm, $6 mezcal/$8 margaritas), South Beach Bar & Grille (daily 3–6pm, ocean views). Full SEO checklist applied: non-blocking fonts, Article JSON-LD with Unsplash `photo-1514362545857-3bc16c4c7d1b` (w=1200, previously verified), ISO 8601 dates with Pacific TZ, FAQPage JSON-LD (4 Q&As mirroring visible FAQ), .blog-related internal links, Yelp external links. Author: Ryan. Wired into `blog.html` grid (top), `sitemap.xml`, `NEWS_ARTICLES` in `js/app.js`. **Note:** Pizza Port OB excluded this run — April 2026 health closure; same-day reinspection + reopen confirmed, but skipped as a precaution. Verify before featuring. PR #222.
- 2026-06-10 · **`venues.hours` convention clarified: operating hours, not HH windows.** The nightly QA job prompt (Rule 5) had the convention backwards — it said `hours = happy hour time windows only`. The actual app convention established by Shane is: **`hours` = general operating hours** (e.g. `Mon–Fri 11am–9pm · Sat–Sun 10am–10pm`); **happy hour time windows belong in `deals[]` as the leading entry** (e.g. `"Happy hour Mon–Fri 3pm–6pm"`). `days[]` = days when happy hour runs. Do NOT store HH windows in the `hours` column. Updated the venues schema note above accordingly.
- 2026-06-10 · **CRITICAL HOTFIX: smart quotes in `NEWS_ARTICLES` broke ALL of `app.js` → whole app stuck on the static landing screen.** Both the Ocean Beach entry (added today) AND the Huntington Beach entry (merged 2026-06-09) had the JS string **delimiters** typed as Unicode curly quotes (`'…'`/`‘…’`) instead of straight ASCII `'`. A curly quote as a delimiter is a `SyntaxError`, so `js/app.js` failed to parse entirely — **none** of it executed (no function defs, no `initAuth()`), and the app died behind the auth gate (the landing screen is static HTML + `onboarding.js`, which parse fine, so it still rendered — masking that the core app was dead). **This means production was broken from the 2026-06-09 HB merge until this fix.** Fixed both lines to straight ASCII delimiters (kept the legitimate internal apostrophe in `Rockin' Fig`, escaped as `\'`). Bumped `app.js?v=20260610b` so cached-broken copies are re-fetched. **HARD RULE for all future runs: after ANY edit to a `.js` file in this repo, run `node --check js/<file>.js` before committing — the model can silently emit Unicode curly quotes (especially in prose-y string content like `NEWS_ARTICLES` excerpts), and there is no build step or CI to catch it. Curly quotes are fine *inside* a string body (lines 3574/3756/4441 have legit `'`), but NEVER as string delimiters.** Hotfix on `claude/intelligent-noether-t2gpub`.
