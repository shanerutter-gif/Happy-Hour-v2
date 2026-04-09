import { useState, useEffect, useCallback } from 'react';
import styles from './TooltipWalkthrough.module.css';

const TT_KEY = 'spotd-tooltips-done';

interface Step {
  selector: string;
  title: string;
  text: string;
  emoji: string;
  pos: 'below' | 'above';
}

const STEPS: Step[] = [
  {
    selector: '[data-tt="search"]',
    title: 'Find Your Spot',
    text: 'Search bars, restaurants, deals, or neighborhoods.',
    emoji: '🔍',
    pos: 'below',
  },
  {
    selector: '[data-tt="filter"]',
    title: 'Personalize It',
    text: 'Filter by day, vibe, or amenities to find exactly what you\u2019re looking for.',
    emoji: '✨',
    pos: 'below',
  },
  {
    selector: '[data-tt="map"]',
    title: 'Map or List',
    text: 'Switch views to explore spots your way.',
    emoji: '🗺️',
    pos: 'below',
  },
  {
    selector: '[data-tt="card"]',
    title: 'Tap to Explore',
    text: 'See deals, check in, leave reviews, and add to your lists.',
    emoji: '🍺',
    pos: 'below',
  },
  {
    selector: '[data-tt="nav"]',
    title: 'You\u2019re All Set!',
    text: 'Explore social, news, and your profile from the nav bar. Enjoy!',
    emoji: '🎉',
    pos: 'above',
  },
];

export function shouldShowTooltips(userId: string | undefined): boolean {
  if (!userId) return false; // Only for logged-in users
  if (localStorage.getItem(TT_KEY)) return false;
  return true;
}

export function TooltipWalkthrough({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [closing, setClosing] = useState(false);

  const currentStep = STEPS[step];

  const updateRect = useCallback(() => {
    const el = document.querySelector(currentStep.selector);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect(r);
      // Scroll into view if needed
      if (r.top < 60 || r.bottom > window.innerHeight - 60) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setRect(el.getBoundingClientRect()), 400);
      }
    } else {
      setRect(null);
    }
  }, [currentStep.selector]);

  useEffect(() => {
    // Delay to let page render
    const timer = setTimeout(updateRect, 300);
    return () => clearTimeout(timer);
  }, [updateRect, step]);

  useEffect(() => {
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [updateRect]);

  const next = () => {
    if (step >= STEPS.length - 1) {
      finish();
    } else {
      setStep(s => s + 1);
    }
  };

  const finish = () => {
    localStorage.setItem(TT_KEY, '1');
    setClosing(true);
    setTimeout(onComplete, 300);
  };

  const pad = 8;

  return (
    <div className={[styles.overlay, closing && styles.overlayOut].filter(Boolean).join(' ')}>
      {/* Semi-transparent backdrop */}
      <div className={styles.backdrop} onClick={next} />

      {/* Highlight cutout */}
      {rect && (
        <div
          className={styles.highlight}
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}

      {/* Tooltip bubble */}
      {rect && (
        <div
          className={[
            styles.bubble,
            currentStep.pos === 'above' ? styles.bubbleAbove : styles.bubbleBelow,
          ].join(' ')}
          style={
            currentStep.pos === 'above'
              ? { bottom: window.innerHeight - rect.top + pad + 16, left: 16, right: 16 }
              : { top: Math.min(rect.bottom + pad + 16, window.innerHeight - 200), left: 16, right: 16 }
          }
        >
          <div className={styles.emoji}>{currentStep.emoji}</div>
          <div className={styles.title}>{currentStep.title}</div>
          <div className={styles.text}>{currentStep.text}</div>
          <div className={styles.footer}>
            <div className={styles.dots}>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={[
                    styles.dot,
                    i === step && styles.dotActive,
                    i < step && styles.dotDone,
                  ].filter(Boolean).join(' ')}
                />
              ))}
            </div>
            {step > 0 && (
              <button className={styles.skip} onClick={finish}>Skip</button>
            )}
            <button className={styles.nextBtn} onClick={next}>
              {step === STEPS.length - 1 ? "Let's go!" : 'Next →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
