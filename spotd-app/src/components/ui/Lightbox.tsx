import { useState, useEffect } from 'react';
import styles from './Lightbox.module.css';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
  /** Optional array for carousel mode */
  images?: string[];
  /** Starting index in images array */
  startIndex?: number;
}

export function Lightbox({ src, alt, onClose, images, startIndex }: Props) {
  const [idx, setIdx] = useState(startIndex ?? 0);
  const list = images && images.length > 0 ? images : [src];
  const currentSrc = list[idx] || src;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < list.length - 1) setIdx(i => i + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx(i => i - 1);
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose, idx, list.length]);

  // Touch swipe for mobile
  let touchStartX = 0;
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx > 50 && idx > 0) setIdx(i => i - 1);
    if (dx < -50 && idx < list.length - 1) setIdx(i => i + 1);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <button className={styles.close} onClick={onClose}>×</button>

      {list.length > 1 && idx > 0 && (
        <button
          className={styles.navBtn + ' ' + styles.navLeft}
          onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1); }}
        >‹</button>
      )}

      <img
        src={currentSrc}
        alt={alt || ''}
        className={styles.image}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />

      {list.length > 1 && idx < list.length - 1 && (
        <button
          className={styles.navBtn + ' ' + styles.navRight}
          onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1); }}
        >›</button>
      )}

      {list.length > 1 && (
        <div className={styles.counter}>{idx + 1} / {list.length}</div>
      )}
    </div>
  );
}
