import { useState, useEffect, useCallback } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import type { Venue, Review } from '../../types/database';
import styles from './VenueSheet.module.css';

interface Props {
  venue: Venue;
  open: boolean;
  onClose: () => void;
}

export function VenueSheet({ venue, open, onClose }: Props) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isGoing, setIsGoing] = useState(false);
  const [goingCount, setGoingCount] = useState(0);

  const today = new Date().toISOString().slice(0, 10);
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

  const loadReviews = useCallback(async () => {
    const { data } = await supabase
      .from('reviews')
      .select('*')
      .eq('venue_id', venue.id)
      .order('created_at', { ascending: false });
    setReviews((data as Review[]) || []);
  }, [venue.id]);

  const checkGoing = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('check_ins')
      .select('id')
      .eq('venue_id', venue.id)
      .eq('user_id', user.id)
      .gte('created_at', today + 'T00:00:00')
      .lte('created_at', today + 'T23:59:59');
    setIsGoing((data?.length || 0) > 0);
  }, [user, venue.id, today]);

  const loadGoingCount = useCallback(async () => {
    const { data } = await supabase
      .from('check_ins')
      .select('id')
      .eq('venue_id', venue.id)
      .gte('created_at', today + 'T00:00:00')
      .lte('created_at', today + 'T23:59:59');
    setGoingCount(data?.length || 0);
  }, [venue.id, today]);

  useEffect(() => {
    if (open) {
      loadReviews();
      checkGoing();
      loadGoingCount();
    }
  }, [open, loadReviews, checkGoing, loadGoingCount]);

  const handleCheckIn = async () => {
    if (!user) {
      showToast({ text: 'Sign in to check in', type: 'error' });
      return;
    }
    if (isGoing) {
      // Un-check-in
      await supabase
        .from('check_ins')
        .delete()
        .eq('venue_id', venue.id)
        .eq('user_id', user.id)
        .gte('created_at', today + 'T00:00:00');
      setIsGoing(false);
      setGoingCount((c) => Math.max(0, c - 1));
      showToast({ text: 'Check-in removed' });
    } else {
      await supabase
        .from('check_ins')
        .insert({ venue_id: venue.id, user_id: user.id, city_slug: venue.city });
      setIsGoing(true);
      setGoingCount((c) => c + 1);
      showToast({ text: `Checked in to ${venue.name}!`, type: 'success' });
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className={styles.content}>
        {/* Tag */}
        <span className={styles.tag}>
          {venue.type === 'hh' ? '🍺 Happy Hour' : '🎉 Event'}
        </span>

        {/* Name & location */}
        <h2 className={styles.name}>{venue.name}</h2>
        <p className={styles.hood}>{venue.neighborhood}</p>
        <p className={styles.addr}>{venue.address}</p>

        <div className={styles.divider} />

        {/* When */}
        <div className={styles.section}>
          <span className={styles.label}>When</span>
          <p className={styles.when}>{venue.when_text || 'Check schedule'}</p>
          {venue.days && venue.days.length > 0 && (
            <div className={styles.days}>
              {venue.days.map((d) => (
                <Pill
                  key={d}
                  variant="day"
                  active={d.toLowerCase().startsWith(todayDay)}
                >
                  {d}
                </Pill>
              ))}
            </div>
          )}
        </div>

        {/* Deals */}
        {venue.deals && venue.deals.length > 0 && (
          <div className={styles.section}>
            <span className={styles.label}>Deals</span>
            <ul className={styles.deals}>
              {venue.deals.map((deal, i) => (
                <li key={i}>{deal}</li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.divider} />

        {/* Going button */}
        <div className={styles.goingWrap}>
          <Button
            variant={isGoing ? 'secondary' : 'primary'}
            fullWidth
            size="lg"
            onClick={handleCheckIn}
            className={styles.goingBtn}
          >
            {isGoing ? '✓ Going Tonight' : `I'm Going${goingCount > 0 ? ` · ${goingCount} going` : ''}`}
          </Button>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button className={styles.action}>
            <span className={styles.actionIcon}>📍</span>
            <span>Directions</span>
          </button>
          <button className={styles.action}>
            <span className={styles.actionIcon}>📤</span>
            <span>Share</span>
          </button>
          <button className={styles.action}>
            <span className={styles.actionIcon}>📋</span>
            <span>Add to List</span>
          </button>
          <button className={styles.action}>
            <span className={styles.actionIcon}>🔥</span>
            <span>Fire</span>
          </button>
        </div>

        <div className={styles.divider} />

        {/* Reviews */}
        <div className={styles.section}>
          <span className={styles.label}>Reviews ({reviews.length})</span>
          {reviews.length === 0 ? (
            <p className={styles.noReviews}>No reviews yet — be the first!</p>
          ) : (
            reviews.slice(0, 5).map((r) => (
              <div key={r.id} className={styles.review}>
                <div className={styles.reviewHead}>
                  <span className={styles.reviewStars}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                  <span className={styles.reviewDate}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                {r.text && <p className={styles.reviewText}>{r.text}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </Sheet>
  );
}
