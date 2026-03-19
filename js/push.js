/* ═══════════════════════════════════════════════════════
   SPOTD — PUSH NOTIFICATIONS
   Works in both contexts:
     • Web browser (via Service Worker + Web Push API)
     • Capacitor iOS/Android (via @capacitor/push-notifications)
   ═══════════════════════════════════════════════════════ */

// ── DETECT CONTEXT ─────────────────────────────────────
const isNative = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

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

// Native (Capacitor) push permission
async function requestNativePush() {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }
    if (permStatus.receive !== 'granted') return false;

    await PushNotifications.register();

    // Listen for the device token (send this to your server/Supabase)
    PushNotifications.addListener('registration', token => {
      console.log('[Push] Device token:', token.value);
      savePushToken(token.value);
    });

    // Handle foreground notifications
    PushNotifications.addListener('pushNotificationReceived', notification => {
      console.log('[Push] Received:', notification);
      // Show in-app toast instead of system notification when app is open
      if (typeof showToast === 'function') {
        showToast(notification.title || 'New from Spotd');
      }
    });

    // Handle notification tap
    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const url = action.notification.data?.url;
      if (url) window.location.href = url;
    });

    PushNotifications.addListener('registrationError', err => {
      console.error('[Push] Registration error:', err);
    });

    return true;
  } catch(e) {
    console.warn('[Push] Native push error:', e);
    return false;
  }
}

// ── SAVE PUSH TOKEN TO SUPABASE ────────────────────────
// Store the device token so your server can send targeted notifications
async function savePushToken(token) {
  if (!currentUser || !token) return;
  try {
    await db.from('push_tokens').upsert({
      user_id: currentUser.id,
      token,
      platform: isNative() ? (window.Capacitor?.getPlatform?.() || 'native') : 'web',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, platform' });
    console.log('[Push] Token saved');
  } catch(e) {
    console.warn('[Push] Token save failed:', e);
  }
}

// ── HAPTIC FEEDBACK (native only) ──────────────────────
async function haptic(style = 'light') {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] || ImpactStyle.Light });
  } catch(e) {}
}

// ── PROMPT HELPER — ask at the right moment ────────────
// Call this AFTER a user does something positive (check-in, save a spot)
// NOT on first app open — that tanks acceptance rates
async function promptPushIfAppropriate() {
  if (typeof window === 'undefined') return;
  if (isNative()) return; // Capacitor handles its own timing

  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;

  // Only prompt after user has shown intent (checked in or saved 2+ spots)
  const checkIns = await fetchAllCheckIns(currentUser?.id);
  const favs     = await getFavoriteItems(currentUser?.id);
  if ((checkIns?.length || 0) + (favs?.length || 0) < 2) return;

  // Show a soft in-app prompt first (much better than cold browser prompt)
  showPushPromptBanner();
}

function showPushPromptBanner() {
  if (document.getElementById('pushBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'pushBanner';
  banner.style.cssText = `
    position:fixed; bottom:80px; left:16px; right:16px; z-index:500;
    background:#2A1F14; color:#F5EFE6; border-radius:14px;
    padding:14px 16px; display:flex; align-items:center; gap:12px;
    box-shadow:0 8px 24px rgba(42,31,20,0.25);
    animation: slideUp 300ms cubic-bezier(0.34,1.56,0.64,1) both;
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5EFE6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 3 11 3s2 .5 3 .5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/></svg></div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px">Get tonight's happy hours</div>
      <div style="font-size:12px;opacity:.6">4pm alerts when spots near you open up</div>
    </div>
    <button onclick="acceptPushBanner()" style="background:#FF6B4A;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap">Turn on</button>
    <button onclick="dismissPushBanner()" style="background:none;border:none;color:rgba(245,239,230,0.4);font-size:18px;cursor:pointer;padding:4px;line-height:1">✕</button>
  `;
  document.body.appendChild(banner);
}

async function acceptPushBanner() {
  dismissPushBanner();
  const granted = await requestWebPush();
  if (granted) {
    showToast('You\'ll get tonight\'s happy hour alerts!');
    await subscribeWebPush();
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
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE'; // replace this

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
