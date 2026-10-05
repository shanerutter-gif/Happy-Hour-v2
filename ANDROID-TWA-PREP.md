# Branch: feature/android-twa-prep

Technical prep for shipping Spotd on the Google Play Store as a Trusted Web
Activity (TWA). Branched from `main`. **Do NOT merge or deploy without the
founder's go-ahead** — the Play Console account doesn't exist yet, and
`.well-known/assetlinks.json` still carries a placeholder fingerprint.

## What's in this branch

| Area | Change |
|---|---|
| PWA icons | Generated `/icons/icon-{72,96,128,144,152,180,192,384,512}.png` (coral pin mark, maskable-safe). The old `icon-180.png` was replaced for brand consistency. |
| Manifest | `related_applications` fixed to the real App Store URL (`id6760452388`); 2 real product screenshots added with true sizes; `start_url`, `display`, colors already correct. |
| Screenshots | `/screenshots/home.png` (580×1287), `/screenshots/venues.png` (593×1345) — cropped from the real logged-in app footage in `~/workspace/spotd-app-qa/ad-v2/` (mobile-ad-v2 segments). |
| assetlinks | `/.well-known/assetlinks.json` + explicit `vercel.json` route. **Fingerprint is `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`** — finalize per `TWA-BUILD-RUNBOOK.md` §6 after the Play app exists. |
| Web push | `api/_lib/webpush.js` (new, pure node:crypto: VAPID JWT + RFC 8291 aesgcm encryption); `api/send-push.js` now delivers to `platform = web \| android` tokens; diagnose mode reports whether `VAPID_PRIVATE_KEY` matches the client key in `js/push.js`. |
| Service worker | `sw.js` notification icon/badge fixed to `/icons/icon-192.png` (old `/img/` path 404'd). |
| Tooling | `scripts/generate-vapid-keys.mjs` — VAPID pair generator for rotation. |
| Docs | `TWA-BUILD-RUNBOOK.md` — the full path from here to a Play listing. |

## Env vars (Vercel, Production + Preview)

- `VAPID_PRIVATE_KEY` — base64url raw 32-byte P-256 key. **Verify it matches
  the client key before sending anything**: `POST /api/send-push
  {"diagnose": true}` → `webpush.matches_client_key`. If false, run
  `node scripts/generate-vapid-keys.mjs` and update both `js/push.js`
  (`VAPID_PUBLIC_KEY`) and this env var.
- `PUSH_API_KEY` — already exists (auth for `/api/send-push`).

## Deliberately NOT in this branch

- The Bubblewrap build itself (needs the upload keystore; trivial once the
  Play account exists — see runbook §2–4).
- Real signing fingerprint in assetlinks (needs Play App Signing — §6).
- `api/push-runner.js` web-platform enablement (one-line change; waiting on
  a successful test push first — runbook §8–9).
- `/app-download` Android routing (needs the Play listing URL — runbook §8).
- `manifest.json` Play Store `related_applications` entry (same reason).

## Test evidence (all local, pre-deploy)

- `node /tmp/webpush-test.mjs`: RFC 8291 encrypt→decrypt round-trip **pass**;
  VAPID JWT signature verifies against derived public key **pass**.
- Manifest validator: 9/9 icons exist with declared dimensions, 2/2
  screenshots exist, no placeholder App Store ID — **pass**.
- Local HTTP: `/manifest.json`, `/icons/icon-192.png`, `/icons/icon-512.png`,
  `/screenshots/*.png`, `/.well-known/assetlinks.json` all **200** with
  correct content types.
- `node --check` clean on `api/send-push.js`, `api/_lib/webpush.js`,
  `scripts/generate-vapid-keys.mjs`.
