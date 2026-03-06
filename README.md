# Spotd

**Find tonight's best happy hours and events near you.**

Happy hours · Trivia · Live music · Karaoke · Bingo · Game nights · Comedy — curated for every major city.

---

## Setup (do these in order)

### 1. Add Supabase keys to `js/db.js`

Replace the two placeholders at the top of `js/db.js`:

```js
const SUPABASE_URL      = 'https://yourproject.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

Find both at: **Supabase → Project Settings → API**

### 2. Run schema in Supabase SQL Editor

Run `sql/schema.sql` first, then `sql/seed_san_diego.sql` to populate SD venues.

### 3. Vercel environment variables

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | `service_role` key (not anon) |

### 4. Deploy

```bash
git init && git add . && git commit -m "Spotd v1"
git remote add origin https://github.com/YOUR/REPO.git
git push -u origin main
```

Import on vercel.com → New Project → Root Directory: leave blank.

---

## Adding venues or events

Insert directly into Supabase via the dashboard or SQL Editor:

```sql
-- Add a venue
insert into venues (city_slug,name,neighborhood,address,lat,lng,hours,days,cuisine,deals,url)
values ('san-diego','Bar Name','North Park','1234 30th St',32.7517,-117.1283,'4–7pm',
        ARRAY['Mon','Tue','Wed','Thu','Fri'],'American',
        ARRAY['$5 drafts','$7 cocktails'],'https://bar.com');

-- Add an event
insert into events (city_slug,name,event_type,venue_name,neighborhood,address,lat,lng,hours,days,description,price,url)
values ('san-diego','Tuesday Trivia Night','Trivia','The Local','North Park','1234 30th St',
        32.7517,-117.1283,'7–9pm',ARRAY['Tue'],'Free trivia every Tuesday. Teams up to 6.','Free','');

-- Activate a new city
update cities set active = true where slug = 'los-angeles';
```

---

## Cities

| City | Status |
|---|---|
| San Diego, CA | ✅ Live |
| Los Angeles, CA | 🔜 Coming soon |
| New York, NY | 🔜 Coming soon |
| Chicago, IL | 🔜 Coming soon |
| Austin, TX | 🔜 Coming soon |
| Miami, FL | 🔜 Coming soon |
| Orange County, CA | 🔜 Coming soon |

To launch a city: add venues/events for that slug, then `update cities set active = true where slug = 'city-slug'`.
