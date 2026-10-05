#!/usr/bin/env node
// scripts/pull-instagram-metrics.mjs — daily Instagram pull for the
// admin portal's Social Analytics section.
//
// Usage:
//   node scripts/pull-instagram-mjs.mjs --dry-run   # print payload, send nothing
//   METRICS_INGEST_TOKEN=xxx node scripts/pull-instagram-metrics.mjs
//
// What it does:
//   1. instagram-cli accounts                       → pick the linked account
//   2. user-profile --username spotdtoday           → follower count (public read)
//   3. posts --username spotdtoday --limit 50       → per-post likes/comments/urls
//   4. account-insights (best-effort)               → reach/views/interactions
//   5. POSTs { social_daily_metrics, social_posts } to /api/metrics-ingest.js
//
// Known limitation (verified 2026-10-05): the only linked Instagram account is
// the founder's PERSONAL account, so account-insights returns HTTP 500 (no
// insights API on personal accounts) and @spotdtoday is not linked. Until
// @spotdtoday is linked as a professional account, views/reach/interactions/
// profile_visits stay NULL and per-post views/shares stay NULL (the CLI never
// exposes those per post). Follower count and per-post likes/comments come
// from public reads and work today.
//
// Rate limits: stops immediately on HTTP 429. Stops the insights bulk read
// after the first HTTP 500 (per the instagram skill).

import { execFileSync } from 'node:child_process';

const DRY_RUN = process.argv.includes('--dry-run');
const INGEST_URL = 'https://www.spotd.biz/api/metrics-ingest';
const TARGET_USERNAME = 'spotdtoday';

function log(...a) { console.log('[ig-pull]', ...a); }
function warn(...a) { console.warn('[ig-pull] WARN', ...a); }

function cli(...args) {
  try {
    const out = execFileSync('instagram-cli', args, {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90000,
    });
    return JSON.parse(out);
  } catch (e) {
    const stderr = (e.stderr || e.message || '').toString();
    if (/429|Too Many Requests/i.test(stderr)) {
      console.error('[ig-pull] FATAL: Instagram rate limit (429) — stopping all calls.');
      process.exit(2);
    }
    throw new Error(`instagram-cli ${args[0]} failed: ${stderr.slice(0, 300)}`);
  }
}

// Yesterday in America/Los_Angeles — the most recent complete day.
function yesterdayPT() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const d = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const day = yesterdayPT();
  const now = new Date().toISOString();
  log(`pulling Instagram metrics for @${TARGET_USERNAME}, attributing to day ${day}`);

  // 1. Linked account
  const accts = cli('accounts');
  const accounts = (accts && accts.accounts) || [];
  if (!accounts.length) {
    console.error('[ig-pull] FATAL: no linked Instagram account. Run `instagram-cli connect-url`.');
    process.exit(1);
  }
  const acct = accounts.find(a => (a.username || '').toLowerCase() === TARGET_USERNAME) || accounts[0];
  const accountId = acct.user_fbid;
  log(`using linked account @${acct.username} (${accounts.length} linked)`);
  if ((acct.username || '').toLowerCase() !== TARGET_USERNAME) {
    warn(`@${TARGET_USERNAME} is NOT the linked account — insights unavailable; using public reads only.`);
  }

  // 2. Follower count (public read — works today)
  let followers = null;
  try {
    const prof = cli('user-profile', '--account-id', accountId, '--username', TARGET_USERNAME);
    const p = (prof.profiles && prof.profiles[0]) || {};
    followers = typeof p.follower_count === 'number' ? p.follower_count : null;
    log(`followers: ${followers ?? 'unknown'}`);
  } catch (e) {
    warn('user-profile failed:', e.message);
  }

  // 3. Posts (public read — works today; likes/comments only, no per-post views)
  let posts = [];
  try {
    const res = cli('posts', '--account-id', accountId, '--username', TARGET_USERNAME, '--limit', '50');
    posts = (res.posts || []).filter(p => (p.username || '').toLowerCase() === TARGET_USERNAME);
    log(`fetched ${posts.length} @${TARGET_USERNAME} posts${res.has_next_page ? ' (more pages exist)' : ''}`);
  } catch (e) {
    warn('posts fetch failed:', e.message);
  }

  // 4. Account insights (best-effort — 500s on personal accounts)
  let insights = null;
  try {
    const ins = cli('account-insights', '--account-id', accountId, '--period', 'last_30_days');
    insights = ins;
    log('account-insights succeeded');
  } catch (e) {
    warn('account-insights unavailable (expected until @spotdtoday is linked as a professional account):', e.message);
  }

  // 5. Normalize
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const postsPublished = posts.filter(p => {
    const t = p.created_at ? new Date(p.created_at).getTime() : (p.post_created_at?.utc ? new Date(p.post_created_at.utc).getTime() : NaN);
    return Number.isFinite(t) && t >= cutoff;
  }).length;

  const dailyRow = {
    day,
    platform: 'instagram',
    followers,
    views: null,          // not exposed by the CLI
    reach: null,          // needs account-insights on a linked professional account
    interactions: null,   // same
    profile_visits: null, // same
    posts_published: postsPublished,
    collected_at: now,
  };

  const postRows = posts.map(p => {
    const cap = (p.post_caption || '').replace(/\s+/g, ' ').trim();
    const created = p.created_at || p.post_created_at?.utc || null;
    return {
      platform: 'instagram',
      post_id: String(p.post_id),
      posted_at: created ? new Date(created).toISOString() : null,
      url: p.url || null,
      caption_snippet: cap.slice(0, 120) || null,
      views: null, // CLI does not expose per-post views
      likes: typeof p.likes === 'number' ? p.likes : null,
      comments: typeof p.comments === 'number' ? p.comments : null,
      shares: null, // CLI does not expose per-post shares
      collected_at: now,
    };
  });

  const payload = { dailyRow, postRows };

  if (DRY_RUN) {
    console.log('--- DRY RUN: payload that would be sent ---');
    console.log(JSON.stringify({
      tables: {
        social_daily_metrics: { rows: [dailyRow] },
        social_posts: { rows: postRows },
      },
    }, null, 2));
    log(`dry run complete: 1 daily row + ${postRows.length} post rows. Nothing sent.`);
    return;
  }

  // 6. Real POST to the ingest endpoint
  const token = process.env.METRICS_INGEST_TOKEN;
  if (!token) {
    console.error('[ig-pull] FATAL: METRICS_INGEST_TOKEN env is not set.');
    process.exit(1);
  }
  for (const [table, rows] of [['social_daily_metrics', [dailyRow]], ['social_posts', postRows]]) {
    if (!rows.length) { log(`skipping ${table}: no rows`); continue; }
    const r = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-token': token },
      body: JSON.stringify({ table, rows }),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error(`[ig-pull] FATAL: ingest ${table} failed: HTTP ${r.status} ${body.slice(0, 300)}`);
      process.exit(1);
    }
    log(`ingested ${table}: ${body.slice(0, 200)}`);
  }
  log('done.');
}

main().catch(e => { console.error('[ig-pull] FATAL:', e.message); process.exit(1); });
