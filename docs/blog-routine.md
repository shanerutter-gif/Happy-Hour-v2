# Blog routine — automated twice-weekly post (DB-backed, draft-for-approval)

**Purpose:** produce one high-quality, SEO-complete blog post and insert it into
the `blog_posts` Supabase table as a **draft**. No PR, no merge, no deploy — the
post is pure data. A human approves it in the admin Blog Manager (Tools → Blog
Manager → Edit → set status *Published* → Save).

**Cadence:** twice a week (e.g. Tue + Fri). Rotate cities so we don't over-index
on one market.

**Run this whole routine top to bottom. Do NOT skip the verification steps.**

---

## 0. Context you must load first
- Read `CLAUDE.md` (voice, vendors, hard rules, the Blog post SEO checklist).
- **Write only for LIVE cities.** The source of truth is the `active:true` rows
  in the `CITIES` array in `js/app.js` — read it each run so the routine adapts
  automatically as cities launch or pause. As of the last update the live cities
  are: **San Diego, Orange County, Los Angeles, New York, Chicago, Austin,
  Miami** (all 7). Never write for a city that isn't `active:true`.

## 1. Pick the city (rotate across ALL live cities — least-recently-covered wins)
Goal: even coverage across every live city, not just one or two. Steps:
1. Read the live-city slugs from `js/app.js` (`CITIES` where `active:true`).
2. Find each live city's most-recent post date:
   ```sql
   select city_slug, max(created_at) as last_post
   from public.blog_posts
   group by city_slug;
   ```
3. Pick the live city that is **most overdue**: any live city with ZERO posts
   comes first (rotate among them if several); otherwise the live city whose
   `last_post` is oldest. This guarantees the rotation cycles through every city
   before repeating. If the table is empty, default to `san-diego`.
- Note: with 7 live cities and a twice-weekly cadence, each city gets a fresh
  post roughly every 3–4 weeks. That's a healthy pace; do not batch multiple
  cities in one run — **one post per run**.

## 2. Pick a timely, NON-DUPLICATE topic
- Use web search to find what's genuinely current in that city right now
  (new openings, seasonal angles, events, trending neighborhoods, deals).
- Pull the list of slugs already used so you never repeat a topic/slug:
  ```sql
  select slug, title from public.blog_posts;
  ```
  Also avoid the 26 static slugs (the `blog/*.html` files in the repo) — a DB
  slug must NOT equal a static filename stem (would create two near-dup URLs).
- Favor evergreen-with-a-hook angles: neighborhood happy-hour guides, "best X
  for [season]", rooftop/patio/dog-friendly/late-night roundups, day-of-week
  deals. One fresh angle per run.

## 3. Research & VERIFY (no fabrication)
- For every venue you name: confirm it's real and currently open, and verify the
  happy-hour **days, times, and any specific prices** against a primary or
  reputable source (official site, Yelp, King of Happy Hour, local press).
- If you can't verify a detail, leave it out or phrase it generally. **Never
  invent prices or hours.** Accuracy is our whole SEO edge.
- 4–6 real venues is plenty. Prefer venues that exist in our `venues` table when
  you can, but well-known verified spots are fine.

## 4. Write the post (800–1200 words, markdown)
- Conversational, human, specific. A clear narrative arc, not a listicle dump.
- Include **at least one surprising local insight** (the kind of thing only a
  regular knows).
- Structure: compelling headline → 2–3 sentence intro → 3–4 `##` body sections →
  short conclusion with a call-to-action ("…this weekend").
- Only Yelp-link a venue when you have its **confirmed** Yelp URL (a guessed
  slug = a broken link). Bold the name otherwise.
- Markdown only (the renderer supports `##`/`###`, `**bold**`, `*italic*`,
  `[text](url)`, `- lists`, `> quote`).

## 5. Build the SEO fields
- `title` — compelling, includes the primary keyword + city + year.
- `slug` — kebab-case, unique (checked in step 2), descriptive.
- `excerpt` — 1–2 sentences (shows on cards).
- `meta_description` — ~150–160 chars.
- `keywords` — 2–3 target keywords (decent volume, low competition) woven in.
- `featured_image_url` — a relevant Unsplash URL at `w=1200`. **Verify it
  returns HTTP 200 with curl before using it** (dead image = broken hero):
  `curl -s -o /dev/null -w "%{http_code}" "<url>"`.
- `tag` — e.g. `City Guide` / `Neighborhood Guide` / `Events` / `Tips`.
- `city_slug` — from step 1.
- `author` — a RANDOM editorial alias, **never "Shane"**. Pool: Alexis, Ryan,
  John, Maya, Carlos, Priya, Diego, Sofia, Jordan, Emma, Tyler, Nina, Marcus,
  Olivia, Leah, Olivia.
- `faq` — exactly 4 Q&As as a JSON array `[{"q":"…","a":"…"}, …]`. These render
  as FAQPage JSON-LD + a visible FAQ. Make them genuinely useful.

## 6. Insert as a DRAFT
Use the Supabase MCP `execute_sql` with **dollar-quoting** so apostrophes in the
content/FAQ don't need escaping. Set `status` to `'draft'`.
```sql
insert into public.blog_posts
  (slug, title, author, tag, city_slug, excerpt, meta_description, keywords,
   featured_image_url, content, faq, status)
values (
  'the-slug', 'The Title', 'Maya', 'City Guide', 'san-diego',
  'excerpt…', 'meta…', 'kw1, kw2, kw3', 'https://images.unsplash.com/…?w=1200&q=80',
  $md$<markdown body>$md$,
  $faq$[{"q":"…","a":"…"}]$faq$::jsonb,
  'draft'
)
returning slug, status, created_at;
```

## 7. Verify + report (do not skip)
- Confirm the row exists and `status='draft'`:
  ```sql
  select slug, title, status from public.blog_posts where slug = 'the-slug';
  ```
- A draft is intentionally **invisible** publicly (the renderer + grid + sitemap
  filter `status='published'`, and RLS hides it from the anon key) — that's
  correct. It's only visible to the admin (service role) in the Blog Manager.
- Report back: the title, the slug, the city, and a one-line note that it's
  waiting in **Tools → Blog Manager** for one-click approval. Include the URL it
  WILL live at once published: `https://www.spotd.biz/blog/<slug>`.

## Guardrails
- **Draft only.** Never insert `status='published'` from this routine — a human
  approves.
- **One post per run.**
- **Never reuse a slug** (DB or static). **Never fabricate** hours/prices.
- **Never "Shane"** as author.
- This routine touches only the `blog_posts` table — it does not change code, so
  it never needs a PR/merge/deploy.
