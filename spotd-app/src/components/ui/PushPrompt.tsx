import { useState, useEffect } from 'react';
import { requestPushPermission, subscribeWebPush, isNative } from '../../lib/push';
import { showToast } from './Toast';
import styles from './PushPrompt.module.css';

interface Props {
  /** Show immediately (post-signup) vs. re-prompt after action */
  trigger: 'signup' | 'action';
}

export function PushPrompt({ trigger }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already have permission — nothing to show
    if (isNative()) {
      if (localStorage.getItem('nativePushGranted')) return;
    } else {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') return;
      if (Notification.permission === 'denied') return;
    }

    if (trigger === 'signup') {
      if (localStorage.getItem('pushBannerDismissed')) return;
      setVisible(true);
      return;
    }

    // Re-prompt after action
    const dismissed = localStorage.getItem('pushBannerDismissed');
    if (!dismissed) return;
    if (isNative() && localStorage.getItem('nativePushAsked')) return;
    if (Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return;
    setVisible(true);
  }, [trigger]);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem('pushBannerDismissed', String(Date.now()));
  };

  const accept = async () => {
    dismiss();
    const granted = await requestPushPermission();
    if (granted) {
      showToast({ text: "You'll get tonight's happy hour alerts!", type: 'success' });
      if (!isNative()) await subscribeWebPush();
    } else {
      showToast({ text: 'Enable notifications in browser settings to get alerts' });
    }
  };

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={dismiss}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={dismiss}>✕</button>
        <div className={styles.icon}>🍺</div>
        <h3 className={styles.title}>Never miss happy hour</h3>
        <p className={styles.desc}>
          Get a heads-up at 4pm when spots near you kick off their deals.
        </p>
        <button className={styles.accept} onClick={accept}>
          Turn on notifications
        </button>
        <button className={styles.later} onClick={dismiss}>
          Maybe later
        </button>
      </div>
    </div>
  );
}
