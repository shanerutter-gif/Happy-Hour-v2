import { useState } from 'react';
import styles from './AgeGate.module.css';

const AGE_KEY = 'spotd-age-verified';

export function needsAgeGate(): boolean {
  return !localStorage.getItem(AGE_KEY);
}

export function AgeGate({ onVerified }: { onVerified: () => void }) {
  const [denied, setDenied] = useState(false);

  const confirm = (isOldEnough: boolean) => {
    if (isOldEnough) {
      localStorage.setItem(AGE_KEY, '1');
      onVerified();
    } else {
      setDenied(true);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet}>
        {!denied ? (
          <>
            <div className={styles.emoji}>🍸</div>
            <div className={styles.title}>Are you 21 or older?</div>
            <p className={styles.subtitle}>
              Spotd features bars, breweries, and happy hour deals.<br />
              You must be of legal drinking age to continue.
            </p>
            <button className={styles.btnPrimary} onClick={() => confirm(true)}>
              Yes, I'm 21+
            </button>
            <button className={styles.btnSecondary} onClick={() => confirm(false)}>
              No, I'm under 21
            </button>
            <div className={styles.legal}>
              <span className={styles.legalLink}>Privacy Policy</span>
              <span className={styles.legalDot}> · </span>
              <span className={styles.legalLink}>Terms of Service</span>
            </div>
          </>
        ) : (
          <>
            <div className={styles.emoji}>🚫</div>
            <div className={styles.title}>Sorry!</div>
            <p className={styles.subtitle}>
              You must be 21 or older to use Spotd.<br />
              Come back when you're of legal drinking age!
            </p>
          </>
        )}
      </div>
    </div>
  );
}
