/** Push notifications — web + native iOS bridge */
import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = 'BMW9ZANN8ywdnRhtDWmd5haZ9mwI4Dr8n28hO67aNy60h3WPOmGaElvseWgSj9zfw9geaqR5gbVUfMPQ9VvrjfU';

declare global {
  interface Window {
    spotdNative?: boolean;
    webkit?: { messageHandlers: { spotdPush: { postMessage: (msg: string) => void } } };
    onNativePushToken?: (token: string) => void;
    onNativePushResult?: (granted: boolean) => void;
    Capacitor?: { Plugins: { Haptics: { impact: (opts: { style: string }) => Promise<void> } } };
  }
}

export const isNative = () => typeof window !== 'undefined' && !!window.spotdNative;

export async function registerServiceWorker() {
  if (isNative() || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'NAVIGATE') {
        window.location.href = e.data.url;
      }
    });
    return reg;
  } catch {
    return null;
  }
}

export async function requestPushPermission(): Promise<boolean> {
  if (isNative()) return requestNativePush();
  return requestWebPush();
}

async function requestWebPush(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

async function requestNativePush(): Promise<boolean> {
  try {
    return new Promise((resolve) => {
      window.onNativePushToken = (token: string) => {
        savePushToken(token, 'ios');
      };
      window.onNativePushResult = (granted: boolean) => {
        localStorage.setItem('nativePushAsked', '1');
        if (granted) localStorage.setItem('nativePushGranted', '1');
        resolve(granted);
      };
      window.webkit?.messageHandlers.spotdPush.postMessage('requestPermission');
    });
  } catch {
    return false;
  }
}

async function savePushToken(token: string, platform: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !token) return;
  await supabase.from('push_tokens').upsert({
    user_id: user.id,
    token,
    platform,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id, platform' });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeWebPush() {
  if (isNative() || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('push_tokens').upsert({
      user_id: user.id,
      token: JSON.stringify(sub),
      platform: 'web',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, platform' });
  } catch {
    // Push subscription may not be available
  }
}

export async function initPush() {
  await registerServiceWorker();
}
