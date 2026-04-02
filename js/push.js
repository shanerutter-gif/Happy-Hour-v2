/* ═══════════════════════════════════════════════════════
   SPOTD — PUSH NOTIFICATIONS
   Works in both contexts:
     • Web browser (via Service Worker + Web Push API)
     • iOS native wrapper (via WKWebView JS bridge)
   ═══════════════════════════════════════════════════════ */

// ── DETECT CONTEXT ─────────────────────────────────────
const isNative = () => typeof window !== 'undefined' && !!window.spotdNative;

// ── REGISTER SERVICE WORKER (web only) ─────────────────
async function registerServiceWorker() {
  if (isNative() || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[SW] registered', reg.scope);

    // Listen for messages from SW (navigation, sync)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE') {
        window.location.href = e.data.url;
      }
    });

    return reg;
  } catch(e) {
    console.warn('[SW] registration failed:', e);
    return null;
  }
}

// ── REQUEST PERMISSION ─────────────────────────────────
async function requestPushPermission() {
  if (isNative()) {
    return requestNativePush();
  } else {
    return requestWebPush();
  }
}

// Web push permission
async function requestWebPush() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

// Native (iOS WKWebView bridge) push permission
async function requestNativePush() {
  try {
    // Set up token callback before requesting permission
    return new Promise((resolve) => {
      window.onNativePushToken = (token) => {
        console.log('[Push] Device token:', token);
        savePushToken(token, 'ios');
      };
      window.onNativePushResult = (granted) => {
        console.log('[Push] Permission granted:', granted);
        localStorage.setItem('nativePushAsked', '1');
        if (granted) localStorage.setItem('nativePushGranted', '1');
        resolve(granted);
      };
      // Ask native side to show the iOS push permission dialog
      window.webkit.messageHandlers.spotdPush.postMessage('requestPermission');
    });
  } catch(e) {
    console.warn('[Push] Native push error:', e);
    return false;
  }
}

// ── SAVE PUSH TOKEN TO SUPABASE ────────────────────────
// Store the device token so your server can send targeted notifications
async function savePushToken(token, platformOverride) {
  if (!currentUser || !token) return;
  try {
    const platform = platformOverride || (isNative() ? 'ios' : 'web');
    await db.from('push_tokens').upsert({
      user_id: currentUser.id,
      token,
      platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, platform' });
    console.log('[Push] Token saved (' + platform + ')');
  } catch(e) {
    console.warn('[Push] Token save failed:', e);
  }
}

// ── HAPTIC FEEDBACK (native only) ──────────────────────
async function haptic(style = 'light') {
  if (!isNative()) return;
  try {
    const { Haptics } = window.Capacitor.Plugins;
    const map = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
    await Haptics.impact({ style: map[style] || 'LIGHT' });
  } catch(e) {}
}

// ── PROMPT HELPER — ask at the right moment ────────────
// Called in two contexts:
//   1. Right after signup (via enterCity) — immediate soft prompt
//   2. After first check-in, save, or review — re-prompt if they declined at signup
async function promptPushIfAppropriate(isPostSignup) {
  if (typeof window === 'undefined') return;

  // Already have permission — nothing to do
  if (isNative()) {
    if (localStorage.getItem('nativePushGranted')) return;
  } else {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;
  }

  // Post-signup prompt: show immediately (short delay for location dialog to settle)
  if (isPostSignup) {
    // Don't show if user already saw the banner this session
    if (localStorage.getItem('pushBannerDismissed')) return;
    showPushPromptBanner();
    return;
  }

  // Re-prompt after action: only if they previously dismissed
  const dismissed = localStorage.getItem('pushBannerDismissed');
  if (!dismissed) return; // never dismissed = never shown yet (signup prompt will handle)

  // On native: don't re-ask if iOS already asked (system-level)
  if (isNative() && localStorage.getItem('nativePushAsked')) return;

  // Don't re-show if dismissed in the last 7 days
  if (Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

  // Show a soft in-app prompt (much better than cold browser prompt)
  showPushPromptBanner();
}

function showPushPromptBanner() {
  if (document.getElementById('pushBanner')) return;

  // Backdrop overlay
  const overlay = document.createElement('div');
  overlay.id = 'pushBanner';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(42,31,20,0.5); backdrop-filter:blur(4px);
    display:flex; align-items:center; justify-content:center;
    animation: pushFadeIn 250ms ease both;
    padding:24px;
  `;

  // Modal card
  overlay.innerHTML = `
    <style>
      @keyframes pushFadeIn { from { opacity:0 } to { opacity:1 } }
      @keyframes pushScaleIn { from { opacity:0; transform:scale(0.9) } to { opacity:1; transform:scale(1) } }
    </style>
    <div style="
      background:#2A1F14; color:#F5EFE6; border-radius:20px;
      padding:32px 28px; max-width:340px; width:100%;
      box-shadow:0 16px 48px rgba(42,31,20,0.4);
      animation: pushScaleIn 300ms cubic-bezier(0.34,1.56,0.64,1) both;
      text-align:center; position:relative;
    ">
      <button onclick="dismissPushBanner()" style="
        position:absolute; top:12px; right:14px;
        background:none; border:none; color:rgba(245,239,230,0.4);
        font-size:22px; cursor:pointer; padding:4px; line-height:1;
      ">✕</button>
      <div style="margin-bottom:16px">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF6B4A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/>
          <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 3 11 3s2 .5 3 .5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5z"/>
          <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>
        </svg>
      </div>
      <div style="font-weight:800; font-size:20px; margin-bottom:8px;">
        Never miss happy hour
      </div>
      <div style="font-size:15px; opacity:.65; margin-bottom:24px; line-height:1.4;">
        Get a heads-up at 4pm when spots near you kick off their deals.
      </div>
      <button onclick="acceptPushBanner()" style="
        background:#FF6B4A; color:#fff; border:none; border-radius:12px;
        padding:14px 0; font-weight:700; font-size:16px;
        cursor:pointer; font-family:inherit; width:100%;
      ">Turn on notifications</button>
      <div onclick="dismissPushBanner()" style="
        margin-top:14px; font-size:13px; opacity:.4; cursor:pointer;
      ">Maybe later</div>
    </div>
  `;

  document.body.appendChild(overlay);
}

async function acceptPushBanner() {
  dismissPushBanner();
  const granted = await requestPushPermission();
  if (granted) {
    showToast('You\'ll get tonight\'s happy hour alerts!');
    if (!isNative()) await subscribeWebPush();
  } else {
    showToast('Enable notifications in browser settings to get alerts');
  }
}

function dismissPushBanner() {
  document.getElementById('pushBanner')?.remove();
  localStorage.setItem('pushBannerDismissed', Date.now());
}

// ── WEB PUSH SUBSCRIPTION ─────────────────────────────
// Requires a VAPID key pair — generate at: https://vapidkeys.com
// Add your public key to the env var NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = 'BMkbnu3qwis5D-0GOq1boIfSjvfis991VIeFerO6go9bH0M3AMpbSHmYHXqnlfVVBpC_fU8YMn3skSdQId6ZKtc';

async function subscribeWebPush() {
  if (isNative() || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    // Save subscription to Supabase
    await db.from('push_tokens').upsert({
      user_id: currentUser?.id,
      token: JSON.stringify(sub),
      platform: 'web',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, platform' });
    console.log('[Push] Web push subscribed');
  } catch(e) {
    console.warn('[Push] Web push subscribe failed:', e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── INIT (called on app load) ──────────────────────────
async function initPush() {
  await registerServiceWorker();
  if (isNative()) {
    // On native: request permission immediately after sign-in
    // (handled in onAuthChange in app.js)
  }
}

// Auto-init
initPush();
