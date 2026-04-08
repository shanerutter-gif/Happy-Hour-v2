/** Haptic feedback — native iOS only (Capacitor) */

export async function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (typeof window === 'undefined' || !window.Capacitor) return;
  try {
    const { Haptics } = window.Capacitor.Plugins;
    const map = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
    await Haptics.impact({ style: map[style] || 'LIGHT' });
  } catch {
    // Haptics not available
  }
}
