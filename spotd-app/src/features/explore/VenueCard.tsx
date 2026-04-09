import type { Venue } from '../../types/database';
import styles from './VenueCard.module.css';

const AMENITY_MAP: [string, string][] = [
  ['has_happy_hour', '🍺 Happy Hour'],
  ['has_sports_tv', '📺 Sports TV'],
  ['is_dog_friendly', '🐶 Dog Friendly'],
  ['has_live_music', '🎵 Live Music'],
  ['has_karaoke', '🎤 Karaoke'],
  ['has_trivia', '🧠 Trivia'],
  ['has_bingo', '🎯 Bingo'],
  ['has_comedy', '🎭 Comedy'],
];

interface VenueCardProps {
  venue: Venue;
  goingCount: number;
  onClick: () => void;
  tier?: 'hero' | 'compact' | 'standard' | 'event';
  isFavorite?: boolean;
  localsSay?: string | null;
}

export function VenueCard({ venue, goingCount, onClick, tier = 'standard', isFavorite, localsSay }: VenueCardProps) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const isToday = venue.days?.some((d) => d.toLowerCase().startsWith(today));
  const deals = venue.deals || [];
  const v = venue as Record<string, unknown>;
  const amenityTags = AMENITY_MAP.filter(([key]) => v[key]).map(([, label]) => label);

  if (tier === 'hero') {
    return (
      <article className={styles.hero} onClick={onClick}>
        {venue.photo_url && (
          <div className={styles.heroPhoto}>
            <img src={venue.photo_url} alt={venue.name} loading="lazy" />
            <div className={styles.heroGradient} />
            <div className={styles.badges}>
              {goingCount >= 2 && <span className={styles.badgeFire}>🔥 {goingCount} going</span>}
              {isToday && <span className={styles.badgeToday}>Today</span>}
              {isFavorite && <span className={styles.badgeFav}>★</span>}
            </div>
            <div className={styles.heroOverlay}>
              <h3 className={styles.heroName}>{venue.name}{venue.owner_verified ? ' ✓' : ''}</h3>
              <p className={styles.heroHood}>{venue.neighborhood}</p>
              {venue.hours && <p className={styles.heroHours}>{venue.hours}</p>}
              {venue.avg_rating && <span className={styles.heroRating}>★ {venue.avg_rating.toFixed(1)}</span>}
              {deals.length > 0 && (
                <div className={styles.heroDealPills}>
                  {deals.slice(0, 3).map((d, i) => <span key={i} className={styles.heroDealPill}>{d}</span>)}
                </div>
              )}
              {localsSay && <div className={styles.localsSay}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 90 ? localsSay.slice(0, 87) + '…' : localsSay}"</div>}
              {amenityTags.length > 0 && (
                <div className={styles.heroAmenities}>
                  {amenityTags.map((t) => <span key={t} className={styles.amenityPill}>{t}</span>)}
                </div>
              )}
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
            {goingCount >= 2 && <span className={styles.compactBadge}>🔥 {goingCount}</span>}
          </div>
        )}
        <div className={styles.compactBody}>
          <h3 className={styles.compactName}>{venue.name}</h3>
          <div className={styles.compactMeta}>
            {venue.avg_rating && <span className={styles.rating}>★ {venue.avg_rating.toFixed(1)}</span>}
            {goingCount >= 2 && <span className={styles.compactFireInline}>🔥 {goingCount}</span>}
            {isFavorite && <span className={styles.favStar}>★</span>}
          </div>
          {deals.length > 0 && <p className={styles.compactDeal}>{deals.slice(0, 2).join(' · ')}</p>}
          {localsSay && <div className={styles.localsSayInline}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 55 ? localsSay.slice(0, 52) + '…' : localsSay}"</div>}
        </div>
      </article>
    );
  }

  return (
    <article className={styles.card} onClick={onClick}>
      {venue.photo_url && (
        <div className={styles.photo}>
          <img src={venue.photo_url} alt={venue.name} loading="lazy" />
          <div className={styles.badges}>
            {goingCount >= 2 && <span className={styles.badgeFire}>🔥 {goingCount} going</span>}
            {isToday && <span className={styles.badgeToday}>Today</span>}
            {isFavorite && <span className={styles.badgeFav}>★</span>}
          </div>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.header}>
          <h3 className={styles.name}>{venue.name}{venue.owner_verified ? ' ✓' : ''}</h3>
          {venue.avg_rating && (
            <span className={styles.rating}>★ {venue.avg_rating.toFixed(1)}</span>
          )}
        </div>
        <p className={styles.hood}>{venue.neighborhood}</p>
        {deals.length > 0 && <p className={styles.deal}>{deals[0]}</p>}
        {localsSay && <div className={styles.localsSayInline}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 55 ? localsSay.slice(0, 52) + '…' : localsSay}"</div>}
        <div className={styles.meta}>
          {venue.when_text && <span>{venue.when_text}</span>}
          {venue.review_count > 0 && (
            <span>{venue.review_count} review{venue.review_count !== 1 ? 's' : ''}</span>
          )}
        </div>
        {amenityTags.length > 0 && (
          <div className={styles.cardAmenities}>
            {amenityTags.slice(0, 4).map((t) => <span key={t} className={styles.amenityPill}>{t}</span>)}
          </div>
        )}
      </div>
    </article>
  );
}
