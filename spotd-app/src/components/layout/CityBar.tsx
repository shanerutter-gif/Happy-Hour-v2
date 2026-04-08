import { useState, useRef, useEffect } from 'react';
import { useCity } from '../../contexts/CityContext';
import styles from './CityBar.module.css';

export function CityBar() {
  const { cities, currentCity, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={styles.bar} ref={ref}>
      <button
        className={[styles.pill, open && styles.open].filter(Boolean).join(' ')}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.name}>{currentCity?.name || 'Select City'}</span>
        <span className={styles.arrow}>▾</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          {cities.map((city) => (
            <button
              key={city.slug}
              className={[
                styles.item,
                city.slug === currentCity?.slug && styles.current,
                !city.enabled && styles.disabled,
              ].filter(Boolean).join(' ')}
              onClick={() => {
                if (city.enabled) {
                  setCity(city.slug);
                  setOpen(false);
                }
              }}
              disabled={!city.enabled}
            >
              <span>{city.name}, {city.state}</span>
              {city.slug === currentCity?.slug && <span className={styles.check}>✓</span>}
              {!city.enabled && <span className={styles.soon}>Soon</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
