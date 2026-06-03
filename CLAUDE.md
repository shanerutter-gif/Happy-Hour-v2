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
- `GET /blog/<slug>` → `api/blog-post.js` — SSR blog post from `blog_posts` (has its own markdown→HTML converter).
- `GET /sitemap-venues.xml` → `api/sitemap-venues.js` — only venues with `photo_url IS NOT NULL` (photoless venues stay out of Google's index).

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
- **Desktop layout:** mobile-first. The single desktop breakpoint is
  `@media (min-width:1024px)` (a self-contained block at the END of
  `css/style.css`). It centres `.app-page` in a 1040px frame, shows the
  `.desktop-nav` (top nav, hidden below 1024px), hides the mobile `.bottom-nav`,
  and turns the feed into a 2-column grid via `.card-hero-row`/`.card-std-row`
  wrappers that are `display:contents` on mobile (so mobile is untouched) and
  `display:grid` on desktop. Keep desktop overrides in that one block.

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
- 2026-06-03 · Two-pane desktop list+map view — the desktop layout (≥1024px,
  shipped same day) centres the editorial feed in a 1040px frame, which still
  leaves cream margins on large monitors because the hero→compact→standard feed
  doesn't want to stretch ultra-wide. The real "use the width" move is a
  persistent two-pane discovery view on desktop (scrolling venue list on the
  left, always-on Leaflet map on the right). The `.map-sidebar` already half
  exists (`style.css` shows it at ≥960px when in map view) and `toggleView()`
  flips `state.view` between `list`/`map` — a desktop two-pane would render both
  panes at once instead of toggling. Deferred as a scoped follow-up.

---

## Recent decisions

Append-only architectural / vendor decisions. One line per entry.

<!-- format:
- YYYY-MM-DD · <decision> — <why>. (PR or commit)
-->

- 2026-05-27 · Rewrote CLAUDE.md as the source of truth. Added a Stop hook
  (`.claude/hooks/stop-claude-md-check.sh`) that blocks turn-end if files
  changed but CLAUDE.md didn't, to enforce the "keep this file alive" meta rule.
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
- 2026-06-03 · **Consolidation: shipped 3 blog posts from stale nightly PRs** (#176–178). Added `blog/best-taco-tuesday-san-diego.html` (Jun 1, El Chingon/American Junkie/Barleymash/La Puerta) and `blog/best-happy-hours-little-italy-san-diego.html` (May 31, Ironside/Cloak & Petal/GlassDoor/Piedra Santa/Vincenzo) — cherry-picked blog HTML from the old branches and committed fresh on `claude/consolidation-blog-fixes`. Closed PRs #176/177/178 as superseded. Wired both posts into `blog.html` grid, `sitemap.xml`, and `NEWS_ARTICLES` in `js/app.js`. Fixed broken Unsplash image for North Park entry in `NEWS_ARTICLES` (replaced 404 ID `photo-1574920162043-b872873f19bc` with `photo-1514362545857-3bc16c4c7d1b`). Fixed stale Supabase `deals` data for two North Park venues: The Smoking Goat (hours corrected to 5:30–7pm Mon–Sun) and Caffè Calabria (hours corrected to 6–10pm Wed–Sun, all-day Wednesday), via direct SQL `array_replace`.
