import type { Venue } from '../../types/database';
import styles from './VenueCard.module.css';

interface VenueCardProps {
  venue: Venue;
  goingCount: number;
  onClick: () => void;
  tier?: 'hero' | 'compact' | 'standard' | 'event';
}

export function VenueCard({ venue, goingCount, onClick, tier = 'standard' }: VenueCardProps) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const isToday = venue.days?.some((d) => d.toLowerCase().startsWith(today));
  const deals = venue.deals || [];

  if (tier === 'hero') {
    return (
      <article className={styles.hero} onClick={onClick}>
        {venue.photo_url && (
          <div className={styles.heroPhoto}>
            <img src={venue.photo_url} alt={venue.name} loading="lazy" />
            <div className={styles.heroGradient} />
            <div className={styles.badges}>
              {goingCount > 0 && <span className={styles.badgeFire}>🔥 {goingCount}</span>}
              {isToday && <span className={styles.badgeToday}>Today</span>}
            </div>
            <div className={styles.heroOverlay}>
              <h3 className={styles.heroName}>{venue.name}</h3>
              <p className={styles.heroHood}>{venue.neighborhood}</p>
              {deals.length > 0 && <p className={styles.heroDeal}>{deals[0]}</p>}
            </div>
          </div>
        )}
      </article>
    );
  }

  if (tier === 'compact') {
    return (
      <article className={styles.compact} onClick={onClick}>
        {venue.photo_url && (
          <div className={styles.compactPhoto}>
            <img src={venue.photo_url} alt={venue.name} loading="lazy" />
            {goingCount > 0 && <span className={styles.compactBadge}>🔥 {goingCount}</span>}
          </div>
        )}
        <div className={styles.compactBody}>
          <h3 className={styles.compactName}>{venue.name}</h3>
          <p className={styles.hood}>{venue.neighborhood}</p>
          {venue.avg_rating && (
            <span className={styles.rating}>★ {venue.avg_rating.toFixed(1)}</span>
          )}
        </div>
      </article>
    );
  }

  // Standard card (default)
  return (
    <article className={styles.card} onClick={onClick}>
      {venue.photo_url && (
        <div className={styles.photo}>
          <img src={venue.photo_url} alt={venue.name} loading="lazy" />
          <div className={styles.badges}>
            {goingCount > 0 && <span className={styles.badgeFire}>🔥 {goingCount}</span>}
            {isToday && <span className={styles.badgeToday}>Today</span>}
          </div>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.header}>
          <h3 className={styles.name}>{venue.name}</h3>
          {venue.avg_rating && (
            <span className={styles.rating}>★ {venue.avg_rating.toFixed(1)}</span>
          )}
        </div>
        <p className={styles.hood}>{venue.neighborhood}</p>
        {deals.length > 0 && <p className={styles.deal}>{deals[0]}</p>}
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
