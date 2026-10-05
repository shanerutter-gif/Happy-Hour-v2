# Analytics Dashboards — Operations Guide

Code foundation for the admin portal's **📊 Social Analytics** and **✉️ Email Analytics**
sections (branch `feature/analytics-dashboards`). Both sections read from four
new tables, written daily by a metrics cron via `POST /api/metrics-ingest`.

## Files

| File | Purpose |
|---|---|
| `sql/analytics-dashboards-20261005.sql` | Migration: 4 tables + RLS (apply by hand, see below) |
| `api/metrics-ingest.js` | Token-gated upsert endpoint (`x-ingest-token` header) |
| `admin-social-analytics.js` | Portal UI: Social Analytics (registered in `api/admin-page.js`) |
| `admin-email-analytics.js` | Portal UI: Email Analytics (registered in `api/admin-page.js`) |
| `scripts/pull-instagram-metrics.mjs` | Instagram puller (`--dry-run` tested 2026-10-05) |

## 1. One-time setup

### a) Apply the migration
The shell has no Supabase access. In the Supabase dashboard for the Spotd
project → SQL Editor, paste and run `sql/analytics-dashboards-20261005.sql`.
Verify with:
```sql
select count(*) from public.social_daily_metrics;
select count(*) from public.social_post_metrics;
select count(*) from public.email_daily_metrics;
select count(*) from public.email_campaigns;
```
(all should return 0, no error).

### b) Set the ingest token
1. The token is already generated at
   `~/workspace/goals/grow-and-monetize-spotd/hidden_files/metrics-ingest-token.txt`
   (workspace only — **never commit it**).
2. In Vercel → Spotd project → Settings → Environment Variables, add
   `METRICS_INGEST_TOKEN` with that value (all environments).
3. Redeploy (or wait for the next push) so the edge function picks it up.
4. Smoke test (replace TOKEN):
```sh
curl -s -X POST https://www.spotd.biz/api/metrics-ingest \
  -H 'Content-Type: application/json' -H 'x-ingest-token: TOKEN' \
  -d '{"table":"social_daily_metrics","rows":[]}' | head -c 300
# expect: {"error":"rows must be a non-empty array"}  (proves auth works)
```

### c) Merge + deploy
The branch is `feature/analytics-dashboards`. Merge to `main` only with the
founder's approval; Vercel deploys on push. The portal serves the new modules
from GitHub `main` at request time (`api/admin-page.js` fetches admin.html +
injects SCRIPT_TAGS), so the sections appear within ~1 minute of the merge —
no admin.html edit needed.

## 2. Daily cron specification (do NOT create yet — spec only)

**Schedule:** daily ~06:00 PT (after TikTok Studio's previous-day numbers settle).

**Each run must:**

1. **Instagram** — run the puller (read-only, safe):
   ```sh
   cd ~/workspace/happy-hour-v2
   METRICS_INGEST_TOKEN="$(cat ~/workspace/goals/grow-and-monetize-spotd/hidden_files/metrics-ingest-token.txt)" \
     node scripts/pull-instagram-metrics.mjs
   ```
   Verifies itself (exits nonzero on ingest failure). Logs follower count and
   post count. `--dry-run` prints the payload without sending.

2. **TikTok** — browser task on the shared browser (TikTok Studio):
   - Open TikTok Studio → Analytics for @spotdtoday.
   - Record for **yesterday**: followers, video views, profile views, likes,
     comments, shares (sum across the day's posts), videos published.
   - Per video (last 30 days): post URL, post date, views, likes, comments, shares.
   - POST to the ingest endpoint:
     - `social_daily_metrics`: `{day, platform:'tiktok', followers, views, reach:null, interactions: likes+comments+shares, profile_visits, posts_published}`
     - `social_post_metrics`: one row per video (`post_id` = video id or URL slug).
   - If Studio is unreachable, log it and continue — do not fail the run.

3. **Loops** — browser task (Loops dashboard, magic-link login as shane@spotd.biz):
   - For each active workflow: **yesterday's** sends, opens, clicks,
     unsubscribes, bounces → `email_daily_metrics` rows.
   - Campaigns list (one-offs/broadcasts): id, name, subject, sent_at, sends,
     opens, clicks, unsubscribes, bounces → `email_campaigns` rows
     (`provider_id` = Loops campaign id).
   - If Loops login fails, log it and continue.

4. **Verify** — after all sources, query the ingest tables (via the portal or
   Supabase) and confirm: ≥1 `social_daily_metrics` row per platform for
   yesterday, `email_daily_metrics` rows for each workflow, and post/campaign
   row counts that look sane vs. yesterday. Report the counts.

**Failure handling (mandatory):** wrap each source (Instagram / TikTok / Loops)
in its own try/catch. A failed source records **nulls** for its metrics and
logs the error — it must never fail the whole run or block the other sources.
A source that fails 3 days in a row gets flagged to the founder.

## 3. Known limitations (as of 2026-10-05)

- **Instagram:** only the founder's *personal* account is linked to
  `instagram-cli`; `@spotdtoday` is not linked, so `account-insights` returns
  HTTP 500. Until @spotdtoday is linked as a professional account,
  `views/reach/interactions/profile_visits` stay NULL and per-post
  views/shares stay NULL. Follower count + per-post likes/comments work today
  via public reads. The UI shows "—" for unavailable cells, never 0.
- **TikTok:** no API/CLI access — Studio numbers come from the browser task.
  Reach is not captured (Studio's "reach" definition differs); the column stays
  NULL until someone maps it.
- **Email contacts KPI** reads `public.newsletter_subscribers` (admin JWT).
  If Loops' contact count diverges from that table, the KPI should be
  revisited.
- The `tiktok-studio-recon.md` and `loops-recon.md` briefs referenced in the
  original task do not exist yet — the pull steps above are written to be
  self-sufficient, but dedicated recon docs would tighten them.

## 4. Security notes

- `METRICS_INGEST_TOKEN` grants upsert-only on the four analytics tables. A
  leaked token can at worst rewrite dashboard numbers.
- Portal reads use the signed-in admin's JWT under RLS
  (`public.is_giveaway_admin()`); anon gets nothing.
- The ingest endpoint uses the service-role key server-side only — never in
  the browser.
