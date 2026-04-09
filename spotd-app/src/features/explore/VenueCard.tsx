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
  onToggleFavorite?: () => void;
  localsSay?: string | null;
}

export function VenueCard({ venue, goingCount, onClick, tier = 'standard', isFavorite, onToggleFavorite, localsSay }: VenueCardProps) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const isToday = venue.days?.some((d) => d.toLowerCase().startsWith(today));
  const deals = venue.deals || [];
  const hasSportsTV = venue.amenities?.includes('has_sports_tv') || venue.amenities?.includes('sports');
  const rating = venue.avg_rating || venue.yelp_rating || venue.google_rating;
  const reviewCount = venue.review_count || 0;
  const photo = venue.photo_url || (venue.photo_urls && venue.photo_urls[0]);

  const v = venue as Record<string, unknown>;
  const amenityTags = AMENITY_MAP.filter(([key]) => v[key]).map(([, label]) => label);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.();
  };

  if (tier === 'hero') {
    return (
      <article className={styles.hero} onClick={onClick}>
        <div className={styles.heroPhoto}>
          {photo ? (
            <img src={photo} alt={venue.name} loading="lazy" />
          ) : (
            <div className={styles.heroPlaceholder}>🍺</div>
          )}
          <div className={styles.heroGradient} />

          {/* Top badges */}
          <div className={styles.badges}>
            {goingCount >= 2 && <span className={styles.badgeFire}>🔥 {goingCount} going</span>}
            {hasSportsTV && <span className={styles.badgeSports}>📺 Sports</span>}
            {isToday && <span className={styles.badgeToday}>Today</span>}
          </div>

          {/* Favorite button */}
          <button className={styles.heroFavBtn} onClick={handleFav}>
            {isFavorite ? '★' : '☆'}
          </button>

          {/* Bottom overlay info */}
          <div className={styles.heroOverlay}>
            <h3 className={styles.heroName}>{venue.name}{venue.owner_verified ? ' ✓' : ''}</h3>
            <p className={styles.heroMeta}>
              {venue.neighborhood}
              {rating ? <> · <span className={styles.heroRating}>★ {rating.toFixed(1)}</span></> : null}
              {reviewCount > 0 && <> · {reviewCount} review{reviewCount !== 1 ? 's' : ''}</>}
            </p>
            {venue.hours && <p className={styles.heroHours}>{venue.hours}</p>}

            {/* Deal pills */}
            {deals.length > 0 && (
              <div className={styles.heroDealPills}>
                {deals.slice(0, 3).map((d, i) => (
                  <span key={i} className={styles.dealPill}>{d}</span>
                ))}
              </div>
            )}

            {/* Locals Say */}
            {localsSay && <div className={styles.localsSay}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 90 ? localsSay.slice(0, 87) + '…' : localsSay}"</div>}

            {/* Amenity tags */}
            {amenityTags.length > 0 && (
              <div className={styles.heroAmenities}>
                {amenityTags.map((t) => <span key={t} className={styles.amenityPill}>{t}</span>)}
              </div>
            )}

            {/* Going bar */}
            {goingCount > 0 && (
              <div className={styles.heroGoingBar}>
                <div className={styles.goingAvatars}>
                  {Array.from({ length: Math.min(goingCount, 3) }).map((_, i) => (
                    <span key={i} className={styles.goingAvatar}>👤</span>
                  ))}
                  {goingCount > 3 && <span className={styles.goingMore}>+{goingCount - 3}</span>}
                </div>
                <span className={styles.goingLabel}>{goingCount} going tonight</span>
              </div>
            )}
          </div>
        </div>
      </article>
    );
  }

  if (tier === 'compact') {
    return (
      <article className={styles.compact} onClick={onClick}>
        <div className={styles.compactPhoto}>
          {photo ? (
            <img src={photo} alt={venue.name} loading="lazy" />
          ) : (
            <div className={styles.compactPlaceholder}>🍺</div>
          )}
          {goingCount >= 2 && <span className={styles.compactBadge}>🔥 {goingCount}</span>}
          {hasSportsTV && <span className={styles.compactSportsBadge}>📺</span>}
        </div>
        <div className={styles.compactBody}>
          <h3 className={styles.compactName}>{venue.name}</h3>
          <div className={styles.compactMeta}>
            {rating && <span className={styles.rating}>★ {rating.toFixed(1)}</span>}
            {goingCount >= 2 && <span className={styles.compactFireInline}>🔥 {goingCount}</span>}
            {isFavorite && <span className={styles.favStar}>★</span>}
          </div>
          {deals.length > 0 && <p className={styles.compactDeal}>{deals.slice(0, 2).join(' · ')}</p>}
          {localsSay && <div className={styles.localsSayInline}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 55 ? localsSay.slice(0, 52) + '…' : localsSay}"</div>}
        </div>
        <button className={styles.compactFavBtn} onClick={handleFav}>
          {isFavorite ? '★' : '☆'}
        </button>
      </article>
    );
  }

  // Standard card / event card
  return (
    <article className={styles.card} onClick={onClick}>
      <div className={styles.cardRow}>
        <div className={styles.cardThumb}>
          {photo ? (
            <img src={photo} alt={venue.name} loading="lazy" />
          ) : (
            <span className={styles.thumbPlaceholder}>🍺</span>
          )}
        </div>
        <div className={styles.body}>
          <h3 className={styles.name}>{venue.name}{venue.owner_verified ? ' ✓' : ''}</h3>
          <p className={styles.stdMeta}>
            {venue.neighborhood}
            {venue.when_text && <> · {venue.when_text}</>}
          </p>
          {/* Deal list */}
          {deals.length > 0 && (
            <div className={styles.dealList}>
              {deals.slice(0, 3).map((d, i) => (
                <span key={i} className={styles.dealItem}>→ {d}</span>
              ))}
            </div>
          )}
          {/* Locals Say */}
          {localsSay && <div className={styles.localsSayInline}><span className={styles.localsSayLabel}>Locals say</span> "{localsSay.length > 55 ? localsSay.slice(0, 52) + '…' : localsSay}"</div>}
          {/* Amenity tags */}
          {amenityTags.length > 0 && (
            <div className={styles.cardAmenities}>
              {amenityTags.slice(0, 4).map((t) => <span key={t} className={styles.amenityPill}>{t}</span>)}
            </div>
          )}
          <div className={styles.cardBottom}>
            {goingCount >= 2 ? (
              <span className={styles.cardFire}>🔥 {goingCount} going tonight</span>
            ) : rating ? (
              <span className={styles.cardRating}>★ {rating.toFixed(1)} {reviewCount > 0 && `(${reviewCount})`}</span>
            ) : null}
          </div>
        </div>
        <button className={styles.cardFavBtn} onClick={handleFav}>
          {isFavorite ? '★' : '☆'}
        </button>
      </div>
    </article>
  );
}
