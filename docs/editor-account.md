# Spotd Editorial Account ("Official") setup

How to spin up the Spotd-run editor account that every user auto-follows.

## What's already wired

- New column: `profiles.is_official boolean default false`.
- DB trigger: when a profile is INSERTed, it auto-follows every existing
  `is_official=true` account.
- DB trigger: when a profile UPDATE flips `is_official` from false to true,
  every existing user retroactively follows it.
- Reconciliation INSERT runs at migration time so the system always converges.
- Frontend: profile fetches return `is_official`; the helper `officialBadge()`
  renders an orange "✓ Spotd" pill next to the display name on:
    - All three social feed cards (hero / compact / wide)
    - Own profile page
    - Public profile page

## One-time setup steps

### 1. Create the auth user

The cleanest path is the normal signup flow so we don't have to fight
auth.users from SQL.

1. In a fresh browser / incognito window, open https://spotd.biz
2. Sign up with the email you want to own this account — recommended:
   `editor@spotd.biz` (or `hello@spotd.biz`)
3. Pick a strong password and stash it in your password manager
4. Set the display name to **`Spotd`** (just the brand — the badge tells
   users who it is)
5. Walk through onboarding (vibe / neighborhood / attribution) so the
   profile feels real
6. Sign out

### 2. Polish the profile

Sign back in as the editor account and:

1. Set an avatar — use the Spotd logo or a brand-aligned image
2. Optionally set a header image
3. Write a short bio: "Curating the best of San Diego nightlife. New
   picks every Monday."

### 3. Flip the `is_official` flag

Run this in the Supabase SQL editor (or via the MCP):

```sql
UPDATE public.profiles
SET is_official = true
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'editor@spotd.biz'
);
```

The flip-trigger fires immediately and inserts a `user_follows` row from
every existing user → this account. Sanity check:

```sql
SELECT count(*) AS auto_followers
FROM public.user_follows uf
JOIN public.profiles p ON p.id = uf.following_id
WHERE p.is_official = true;
```

That count should equal `(profiles where is_official=false) - 1` (everyone
minus the editor itself).

### 4. Post the first piece of content

Sign in as the editor and create your first social post (photo upload
through the normal "share a photo" flow). It will appear on every
existing user's Following feed automatically because of the auto-follow.

## Adding more official accounts later

Just repeat the flow:

1. Sign up the new account through the normal signup
2. Run `UPDATE profiles SET is_official = true WHERE id = ...`

The trigger handles the backfill follows on its own.

## Removing official status

```sql
UPDATE public.profiles SET is_official = false WHERE id = '...';
```

Existing follow rows stay in place (users have to manually unfollow if
they want). The badge disappears immediately because it's read live from
the profile row on render.

## Notes / gotchas

- The badge renders inline next to the display name — mobile-safe size,
  works against light and photo backgrounds.
- Auto-follow is one-way: the editor doesn't auto-follow new users back.
- If you want the editor account itself to skip auto-following officials
  on its own first signup, the new-profile trigger already guards against
  self-follow.
- The official account behaves like a regular user otherwise — same DM
  permissions, same like/comment surfaces. Treat the inbox accordingly.
