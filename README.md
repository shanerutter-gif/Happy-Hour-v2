# SD Happy Hour Guide

85+ happy hour venues across San Diego County — interactive map, reviews, favorites, and weekly digest.

---

## Before You Deploy — 4 Things To Do

### 1. Add your Supabase keys to `js/db.js`

Open `js/db.js` and replace the two placeholders at the very top:

```js
const SUPABASE_URL      = 'REPLACE_WITH_YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY';
```

Find both values at: **supabase.com → Your Project → Project Settings → API**
- `SUPABASE_URL` = the Project URL
- `SUPABASE_ANON_KEY` = the `anon public` key (safe to put in browser code)

### 2. Run the SQL schema in Supabase

1. Supabase dashboard → **SQL Editor** → New Query
2. Paste the entire contents of `sql/schema.sql`
3. Click **Run**

### 3. Add environment variables in Vercel

Go to **Vercel → Your Project → Settings → Environment Variables** and add:

| Variable | Value | Where to find |
|---|---|---|
| `SUPABASE_URL` | `https://xyz.supabase.co` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase → Settings → API → `service_role` key |
| `RESEND_API_KEY` | `re_...` | resend.com → API Keys (free account) |
| `CRON_SECRET` | any random string | Make one up, e.g. run `openssl rand -base64 32` |

> After adding env vars, **redeploy once** from Vercel dashboard → Deployments → ⋯ → Redeploy

### 4. Set Root Directory in Vercel to blank

If your GitHub repo has everything inside a subfolder, make sure **Root Directory** in Vercel Settings is set correctly. If all files are at the repo root, leave it blank.

---

## Deploy Steps

```bash
# Push to GitHub
git init && git add . && git commit -m "SD Happy Hour"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Then go to **vercel.com → New Project → Import** your GitHub repo → Deploy.

---

## Features

| Feature | Guest | Logged In |
|---|---|---|
| Browse & filter venues | ✅ | ✅ |
| Interactive map | ✅ | ✅ |
| Read reviews | ✅ | ✅ |
| Post reviews | ✅ | ✅ |
| Edit / delete own reviews | ❌ | ✅ |
| Save favorites (★) | ❌ | ✅ |
| Filter by saved | ❌ | ✅ |
| Follow neighborhoods | ❌ | ✅ |
| Weekly digest email | ❌ | ✅ opt-in |

---

## Adding Venues

Open `data/venues.js` and add to the `VENUES` array:

```js
{
  id: 86,
  name: "Bar Name",
  neighborhood: "North Park",
  address: "1234 30th St, San Diego, CA 92104",
  lat: 32.7517, lng: -117.1283,
  zip: "92104",
  days: ["Mon","Tue","Wed","Thu","Fri"],
  hours: "4pm – 7pm",
  cuisine: "American",
  deals: ["$5 draft beers", "$7 cocktails"],
  type: "happyhour",
  url: "https://barname.com"
}
```

To find lat/lng: right-click any location on Google Maps → the coordinates are the first option.

---

## Auth Notes

- Sign-in works via `/api/auth` proxy — this ensures it works on Chrome iOS and iPhone home screen mode
- Email confirmation is off by default for easier testing. To enable: Supabase → Authentication → Providers → Email → toggle "Confirm email" → set your Vercel URL as Site URL
- Password reset sends a magic link email via Supabase (no extra setup needed)
