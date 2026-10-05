# Spotd Android TWA — Build & Launch Runbook

How to take the prepped PWA and ship it on the Google Play Store as a
Trusted Web Activity (TWA). Technical prep is done on this branch
(`feature/android-twa-prep`); the steps below are what remains, in order.

## 0. Status of this branch (what's already done)

- [x] Full PWA icon set (`/icons/icon-72.png` → `icon-1024.png`), coral pin
      mark, maskable-safe (pin inside the 80% safe zone). Manifest declares
      all 9; all serve 200.
- [x] `manifest.json`: real App Store URL (`id6760452388`), 2 real product
      screenshots, `display: standalone`, `start_url: /`,
      `theme_color: #FF6B4A`, `background_color: #F5EFE6`.
- [x] `/.well-known/assetlinks.json` route live — **contains a placeholder
      SHA-256 fingerprint** (see §4).
- [x] Server-side VAPID web-push sender (`api/_lib/webpush.js`, pure
      node:crypto, no new deps), wired into `api/send-push.js` for
      `platform = web | android` tokens. APNs path untouched.
- [x] `sw.js` notification icon fixed (`/icons/icon-192.png`; `/img/` never existed).

## 1. Founder-only prerequisites (cannot be delegated)

1. **Play Console developer account** — https://play.google.com/console,
   $25 one-time, personal account (no D-U-N-S needed). Complete **government
   ID verification** + the developer verification program.
2. **Recruit 12 Android testers** — real people who will install from the
   closed-test link and stay opted in for 14 continuous days. The clock
   resets if the tester count drops below 12. Plan this early.

## 2. Install Bubblewrap

```bash
npm i -g @bubblewrap/cli
bubblewrap --version   # need >= 1.20 (targets API 36 for new submissions)
# Requires JDK 17:  brew install openjdk@17   (macOS)
```

## 3. Generate the upload keystore

```bash
keytool -genkeypair -v -keystore ~/spotd-upload-keystore.jks \
  -alias spotd-upload -keyalg RSA -keysize 2048 -validity 10000
# Guard the password. If lost, Play Console can reset the upload key —
# the APP SIGNING key (held by Google) is what matters for assetlinks.
```

## 4. Init + build the TWA

```bash
mkdir ~/spotd-twa && cd ~/spotd-twa
bubblewrap init --manifest https://www.spotd.biz/manifest.json
```

Accept/verify these values at the prompts (they mirror `manifest.json`):

| Field | Value |
|---|---|
| Host | `www.spotd.biz` |
| Android package name | `biz.spotd.app` (matches iOS bundle ID) |
| App name / launcher name | `Spotd` |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Theme color | `#FF6B4A` |
| Background color | `#F5EFE6` |
| Signing key path / alias | your keystore from §3 |
| Start URL | `/` |

Then:

```bash
bubblewrap build        # produces app-release-bundle.aab (targets API 36)
```

## 5. Create the Play Console app + enroll in Play App Signing

1. Play Console → **Create app**: name `Spotd`, default language English,
   app type, free.
2. Upload `app-release-bundle.aab` to a **closed testing** track.
3. **Enroll in Play App Signing** when prompted (required). Google now holds
   the app-signing key; your keystore is only the *upload* key.

## 6. Finalize assetlinks.json (THE critical step)

1. In Play Console go to **Setup → App integrity → App signing** and copy
   the **SHA-256 certificate fingerprint** of the **App signing key**
   (NOT the upload key).
2. In this repo, edit `.well-known/assetlinks.json`: replace
   `"REPLACE_WITH_PLAY_APP_SIGNING_SHA256"` with that fingerprint
   (uppercase hex, colon-separated, exactly as shown).
3. Commit + deploy to production. Then verify:
   - https://www.spotd.biz/.well-known/assetlinks.json serves the real JSON
   - Google's tester: https://developers.google.com/digital-asset-links/tools/generator
     (or `adb shell pm verify-app-links --re-verify biz.spotd.app` on device)

If the fingerprint is wrong, Chrome shows a URL bar inside the app instead
of the clean fullscreen TWA. Get this exactly right.

## 7. Closed test → production

1. Share the closed-test opt-in link with your 12 testers; confirm all 12
   show as opted in.
2. Wait **14 continuous days**.
3. Apply for production access; review takes ~7 days.
4. Roll out the production release (staged rollout recommended: 20% → 50% → 100%).

## 8. Post-launch touch-ups

- [ ] Add the Play Store entry to `manifest.json` `related_applications`:
      `{ "platform": "play", "url": "https://play.google.com/store/apps/details?id=biz.spotd.app" }`
- [ ] Update the `/app-download` redirect in `vercel.json`: currently
      hardcoded to the Apple App Store. Route Android user-agents to the
      Play listing (Bubblewrap's generated app already handles intent URLs;
      this is for the marketing link).
- [ ] Enable `platform='web'` in `api/push-runner.js` line 124's default
      token query once you've confirmed a test web push delivers (the
      audiences UI already supports web targeting).

## 9. Test push procedure (before enabling anything automated)

```bash
# 1. Confirm the VAPID key pair matches (no push sent):
curl -X POST https://www.spotd.biz/api/send-push \
  -H "Authorization: Bearer $PUSH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"diagnose": true}'
# -> webpush.matches_client_key must be true. If false, rotate keys:
#    node scripts/generate-vapid-keys.mjs  (update js/push.js + Vercel env)

# 2. Send a REAL test push to one QA user only (inapp:false skips the bell):
curl -X POST https://www.spotd.biz/api/send-push \
  -H "Authorization: Bearer $PUSH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_ids":["<qa-user-uuid>"],"title":"Spotd test","body":"Web push is live","inapp":false}'
# 3. Confirm the notification renders on the QA Android/Chrome device,
#    tapping it opens the URL.
```

## Reference

- Recon report: `~/workspace/goals/grow-and-monetize-spotd/hidden_files/play-store-recon-2026-10-05.md`
- PWA manifest: `/manifest.json` · Icons: `/icons/` · Screenshots: `/screenshots/`
- Web-push sender: `api/_lib/webpush.js` · Wiring: `api/send-push.js`
- VAPID key generation: `scripts/generate-vapid-keys.mjs`
