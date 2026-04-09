/** Haptic feedback — native iOS (Capacitor) + Android web (navigator.vibrate) */

declare global {
  interface Window {
    Capacitor?: {
      Plugins: {
        Haptics: {
          impact: (opts: { style: string }) => Promise<void>;
        };
      };
    };
  }
}

export async function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (typeof window === 'undefined') return;

  // Native Capacitor
  if (window.Capacitor) {
    try {
      const { Haptics } = window.Capacitor.Plugins;
      const map = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
      await Haptics.impact({ style: map[style] || 'LIGHT' });
      return;
    } catch {
      // fall through
    }
  }

  // Web fallback (Android)
  if (navigator.vibrate) {
    const ms = style === 'heavy' ? 30 : style === 'medium' ? 15 : 8;
    navigator.vibrate(ms);
  }
}
