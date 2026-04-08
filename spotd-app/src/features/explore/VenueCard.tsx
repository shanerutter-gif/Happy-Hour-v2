import type { Venue } from '../../types/database';
import styles from './VenueCard.module.css';

interface VenueCardProps {
  venue: Venue;
  goingCount: number;
  onClick: () => void;
}

export function VenueCard({ venue, goingCount, onClick }: VenueCardProps) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const isToday = venue.days?.some((d) => d.toLowerCase().startsWith(today));
  const deals = venue.deals || [];

  return (
    <article className={styles.card} onClick={onClick}>
      {venue.photo_url && (
        <div className={styles.photo}>
          <img src={venue.photo_url} alt={venue.name} loading="lazy" />
          <div className={styles.badges}>
            {goingCount > 0 && (
              <span className={styles.badgeFire}>🔥 {goingCount}</span>
            )}
            {isToday && (
              <span className={styles.badgeToday}>Today</span>
            )}
          </div>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.header}>
          <h3 className={styles.name}>{venue.name}</h3>
          {venue.avg_rating && (
            <span className={styles.rating}>
              ★ {venue.avg_rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className={styles.hood}>{venue.neighborhood}</p>
        {deals.length > 0 && (
          <p className={styles.deal}>{deals[0]}</p>
        )}
        <div className={styles.meta}>
          {venue.when_text && <span>{venue.when_text}</span>}
          {venue.review_count > 0 && (
            <span>{venue.review_count} review{venue.review_count !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </article>
  );
}
