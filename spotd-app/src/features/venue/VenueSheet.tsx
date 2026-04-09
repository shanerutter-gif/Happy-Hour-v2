import { useState, useEffect, useCallback } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { TextArea } from '../../components/ui/Input';
import { PhotoUpload } from '../../components/ui/PhotoUpload';
import { PushPrompt } from '../../components/ui/PushPrompt';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { saveCheckinPhoto } from '../../lib/media';
import { showToast } from '../../components/ui/Toast';
import type { Venue, Review, VenueDescription } from '../../types/database';
import styles from './VenueSheet.module.css';

const AMENITY_ICONS: Record<string, string> = {
  patio: '🌿', dog: '🐕', sports: '🏈', rooftop: '🏙️',
  live_music: '🎵', trivia: '🧠', karaoke: '🎤', comedy: '😂',
};

interface Props {
  venue: Venue;
  open: boolean;
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function VenueSheet({ venue, open, onClose, isFavorite, onToggleFavorite }: Props) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isGoing, setIsGoing] = useState(false);
  const [goingCount, setGoingCount] = useState(0);
  const [descriptions, setDescriptions] = useState<VenueDescription[]>([]);
  const [showDescForm, setShowDescForm] = useState(false);
  const [descText, setDescText] = useState('');
  const [submittingDesc, setSubmittingDesc] = useState(false);
  // Review form state
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  // Edit review state
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [followingVenue, setFollowingVenue] = useState(false);
  // Share via DM state
  const [showSharePicker, setShowSharePicker] = useState(false);
  const [dmContacts, setDmContacts] = useState<{ id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  // Report state
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  // Photo upload state
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [venuePhotos, setVenuePhotos] = useState<{ id: string; photo_url: string; caption: string | null }[]>([]);
  // Push prompt
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  // Daily check-in count
  const [todayCheckInCount, setTodayCheckInCount] = useState(0);
  // Admin edit state
  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [adminFields, setAdminFields] = useState({
    name: '', when_text: '', address: '', deals: '', amenities: '', photo_url: '',
  });
  const [savingAdmin, setSavingAdmin] = useState(false);

  const ADMIN_EMAILS = ['shanerutter@gmail.com'];
  const isAdmin = user && ADMIN_EMAILS.includes(user.email || '');

  const today = new Date().toISOString().slice(0, 10);
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

  const myReview = user ? reviews.find((r) => r.user_id === user.id) : null;

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

  const loadDescriptions = useCallback(async () => {
    const { data } = await supabase
      .from('venue_descriptions')
      .select('*')
      .eq('venue_id', venue.id)
      .order('upvotes', { ascending: false })
      .limit(5);
    setDescriptions((data as VenueDescription[]) || []);
  }, [venue.id]);

  const checkVenueFollow = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('venue_follows')
      .select('id')
      .eq('user_id', user.id)
      .eq('venue_id', venue.id);
    setFollowingVenue((data?.length || 0) > 0);
  }, [user, venue.id]);

  const loadVenuePhotos = useCallback(async () => {
    const { data } = await supabase
      .from('checkin_photos')
      .select('id, photo_url, caption')
      .eq('venue_id', venue.id)
      .order('created_at', { ascending: false })
      .limit(10);
    setVenuePhotos((data || []) as { id: string; photo_url: string; caption: string | null }[]);
  }, [venue.id]);

  const loadTodayCheckIns = useCallback(async () => {
    if (!user) return;
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', today + 'T00:00:00');
    setTodayCheckInCount(count || 0);
  }, [user, today]);

  useEffect(() => {
    if (open) {
      loadReviews();
      loadTodayCheckIns();
      checkGoing();
      loadGoingCount();
      loadDescriptions();
      checkVenueFollow();
      loadVenuePhotos();
      setShowReviewForm(false);
      setEditingReview(null);
      setReviewRating(0);
      setReviewText('');
    }
  }, [open, loadReviews, checkGoing, loadGoingCount, loadDescriptions, checkVenueFollow, loadVenuePhotos, loadTodayCheckIns]);

  const handleCheckIn = async () => {
    if (!user) {
      showToast({ text: 'Sign in to check in', type: 'error' });
      return;
    }
    if (isGoing) {
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
      if (todayCheckInCount >= 5) {
        showToast({ text: 'Daily limit reached (5/day)', type: 'error' });
        return;
      }
      await supabase
        .from('check_ins')
        .insert({ venue_id: venue.id, user_id: user.id, city_slug: venue.city_slug });
      setIsGoing(true);
      setGoingCount((c) => c + 1);
      setTodayCheckInCount((c) => c + 1);
      showToast({ text: `Checked in to ${venue.name}!`, type: 'success' });
      // Prompt for push after first check-in
      if (!localStorage.getItem('pushBannerDismissed') && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => setShowPushPrompt(true), 1500);
      }
    }
  };

  const handleDirections = () => {
    const q = encodeURIComponent(`${venue.name}, ${venue.address}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
  };

  const handleShare = async () => {
    const shareData = {
      title: venue.name,
      text: `Check out ${venue.name} on Spotd!`,
      url: `${window.location.origin}/?spot=${venue.id}`,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => {});
    } else {
      await navigator.clipboard.writeText(shareData.url);
      showToast({ text: 'Link copied!', type: 'success' });
    }
  };

  const handleUpvoteDesc = async (descId: string) => {
    if (!user) {
      showToast({ text: 'Sign in to upvote', type: 'error' });
      return;
    }
    const { data: existing } = await supabase
      .from('description_upvotes')
      .select('id')
      .eq('user_id', user.id)
      .eq('description_id', descId);
    if (existing && existing.length > 0) {
      await supabase.from('description_upvotes').delete().eq('user_id', user.id).eq('description_id', descId);
      setDescriptions((prev) => prev.map((d) => d.id === descId ? { ...d, upvotes: d.upvotes - 1 } : d));
    } else {
      await supabase.from('description_upvotes').insert({ user_id: user.id, description_id: descId });
      setDescriptions((prev) => prev.map((d) => d.id === descId ? { ...d, upvotes: d.upvotes + 1 } : d));
    }
  };

  const submitDescription = async () => {
    if (!user || !descText.trim()) return;
    setSubmittingDesc(true);
    await supabase.from('venue_descriptions').insert({
      venue_id: venue.id,
      user_id: user.id,
      description_text: descText.trim(),
    });
    setDescText('');
    setShowDescForm(false);
    setSubmittingDesc(false);
    loadDescriptions();
    showToast({ text: 'Description added!', type: 'success' });
  };

  const toggleVenueFollow = async () => {
    if (!user) { showToast({ text: 'Sign in to follow', type: 'error' }); return; }
    if (followingVenue) {
      await supabase.from('venue_follows').delete().eq('user_id', user.id).eq('venue_id', venue.id);
      setFollowingVenue(false);
      showToast({ text: 'Unfollowed venue' });
    } else {
      await supabase.from('venue_follows').insert({ user_id: user.id, venue_id: venue.id });
      setFollowingVenue(true);
      showToast({ text: 'Following — you\'ll get updates!', type: 'success' });
    }
  };

  // --- Share via DM ---
  const openSharePicker = async () => {
    if (!user) { showToast({ text: 'Sign in to share', type: 'error' }); return; }
    setShowSharePicker(true);
    setLoadingContacts(true);
    // Get user's follows to populate contact list
    const { data: follows } = await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', user.id);
    const ids = (follows || []).map((f: { following_id: string }) => f.following_id);
    if (ids.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', ids);
      setDmContacts((profiles || []) as { id: string; display_name: string; avatar_url: string | null }[]);
    } else {
      setDmContacts([]);
    }
    setLoadingContacts(false);
  };

  const sendVenueToDm = async (recipientId: string) => {
    if (!user) return;
    // Find or create DM thread
    const { data: existingThreads } = await supabase
      .from('dm_threads')
      .select('*')
      .contains('participants', [user.id, recipientId]);
    let threadId: string;
    const existing = (existingThreads || []).find(
      (t: { participants: string[] }) => t.participants.includes(user.id) && t.participants.includes(recipientId)
    );
    if (existing) {
      threadId = existing.id;
    } else {
      const { data: newThread } = await supabase
        .from('dm_threads')
        .insert({ participants: [user.id, recipientId] })
        .select('id')
        .single();
      if (!newThread) { showToast({ text: 'Failed to create thread', type: 'error' }); return; }
      threadId = newThread.id;
    }
    // Send venue share message
    const shareContent = `📍 Check out ${venue.name}!\n${venue.address}\n${window.location.origin}/?spot=${venue.id}`;
    await supabase.from('dm_messages').insert({
      thread_id: threadId,
      sender_id: user.id,
      content: shareContent,
      message_type: 'venue_share',
      venue_id: venue.id,
    });
    await supabase.from('dm_threads').update({
      last_message: `Shared ${venue.name}`,
      last_message_at: new Date().toISOString(),
    }).eq('id', threadId);
    setShowSharePicker(false);
    const contact = dmContacts.find((c) => c.id === recipientId);
    showToast({ text: `Sent to ${contact?.display_name || 'user'}!`, type: 'success' });
  };

  // --- Report venue ---
  const submitReport = async () => {
    if (!user || !reportReason.trim()) { showToast({ text: 'Enter a reason', type: 'error' }); return; }
    await supabase.from('reports').insert({
      reporter_id: user.id,
      content_type: 'venue',
      content_id: venue.id,
      reason: reportReason.trim(),
    });
    setShowReportForm(false);
    setReportReason('');
    showToast({ text: 'Report submitted — thanks!', type: 'success' });
  };

  // --- Admin edit ---
  const openAdminEdit = () => {
    setAdminFields({
      name: venue.name,
      when_text: venue.when_text || '',
      address: venue.address || '',
      deals: (venue.deals || []).join('\n'),
      amenities: (venue.amenities || []).join(', '),
      photo_url: venue.photo_url || '',
    });
    setShowAdminEdit(true);
  };

  const saveAdminEdit = async () => {
    if (!isAdmin) return;
    setSavingAdmin(true);
    const updates: Record<string, unknown> = {
      name: adminFields.name.trim(),
      when_text: adminFields.when_text.trim(),
      address: adminFields.address.trim(),
      deals: adminFields.deals.split('\n').map((d) => d.trim()).filter(Boolean),
      amenities: adminFields.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      photo_url: adminFields.photo_url.trim() || null,
    };
    const { error } = await supabase.from('venues').update(updates).eq('id', venue.id);
    setSavingAdmin(false);
    if (error) {
      showToast({ text: 'Save failed', type: 'error' });
    } else {
      setShowAdminEdit(false);
      showToast({ text: 'Venue updated!', type: 'success' });
    }
  };

  // --- Photo upload ---
  const handlePhotoUploaded = async (result: { url: string; storagePath: string; type: 'photo' | 'video'; posterUrl?: string }) => {
    if (!user) return;
    await saveCheckinPhoto({
      userId: user.id,
      venueId: venue.id,
      citySlug: venue.city_slug,
      photoUrl: result.url,
      storagePath: result.storagePath,
    });
    setShowPhotoUpload(false);
    loadVenuePhotos();
    showToast({ text: 'Photo added!', type: 'success' });
  };

  // --- Review CRUD ---
  const submitReview = async () => {
    if (!user || reviewRating === 0) {
      showToast({ text: 'Select a star rating', type: 'error' });
      return;
    }
    setSubmittingReview(true);
    if (editingReview) {
      await supabase.from('reviews').update({ rating: reviewRating, text: reviewText.trim() }).eq('id', editingReview.id);
      showToast({ text: 'Review updated!', type: 'success' });
    } else {
      await supabase.from('reviews').insert({
        venue_id: venue.id,
        user_id: user.id,
        rating: reviewRating,
        text: reviewText.trim(),
      });
      showToast({ text: 'Review posted!', type: 'success' });
    }
    setSubmittingReview(false);
    setShowReviewForm(false);
    setEditingReview(null);
    setReviewRating(0);
    setReviewText('');
    loadReviews();
  };

  const startEditReview = (r: Review) => {
    setEditingReview(r);
    setReviewRating(r.rating);
    setReviewText(r.text || '');
    setShowReviewForm(true);
  };

  const deleteReview = async (reviewId: string) => {
    await supabase.from('reviews').delete().eq('id', reviewId);
    showToast({ text: 'Review deleted' });
    loadReviews();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className={styles.content}>
        {/* Photo hero */}
        {venue.photo_url && (
          <div className={styles.photoHero}>
            <img src={venue.photo_url} alt={venue.name} className={styles.photoHeroImg} />
            <div className={styles.photoHeroGrad} />
          </div>
        )}

        {/* Tag + Favorite */}
        <div className={styles.topRow}>
          <span className={styles.tag}>
            {venue.type === 'hh' ? '🍺 Happy Hour' : '🎉 Event'}
          </span>
          {onToggleFavorite && (
            <button className={styles.favBtn} onClick={onToggleFavorite}>
              {isFavorite ? '★' : '☆'}
            </button>
          )}
        </div>

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
                <Pill key={d} variant="day" active={d.toLowerCase().startsWith(todayDay)}>
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

        {/* Amenity Tags */}
        {venue.amenities && venue.amenities.length > 0 && (
          <div className={styles.section}>
            <div className={styles.amenityTags}>
              {venue.amenities.map((a) => (
                <span key={a} className={[styles.amenityTag, styles[`amenity_${a.replace(/\s+/g, '_').toLowerCase()}`]].filter(Boolean).join(' ')}>
                  {AMENITY_ICONS[a] || '✦'} {a}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={styles.divider} />

        {/* Going button */}
        <div className={styles.goingWrap}>
          <Button
            variant={isGoing ? 'secondary' : todayCheckInCount >= 5 ? 'ghost' : 'primary'}
            fullWidth
            size="lg"
            onClick={handleCheckIn}
            className={styles.goingBtn}
            disabled={!isGoing && todayCheckInCount >= 5}
          >
            {isGoing ? '✓ Going Tonight' : todayCheckInCount >= 5 ? 'Daily Limit Reached' : `I'm Going${goingCount > 0 ? ` · ${goingCount} going` : ''}`}
          </Button>
          {user && <span className={styles.checkInCount}>{todayCheckInCount}/5 check-ins today</span>}
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button className={[styles.action, styles.actionPrimary].filter(Boolean).join(' ')} onClick={() => {
            const url = venue.url && venue.url !== '#' && venue.url.trim()
              ? venue.url
              : `https://www.google.com/search?q=${encodeURIComponent(venue.name + ' ' + (venue.neighborhood || ''))}`;
            window.open(url, '_blank');
          }}>
            <span className={styles.actionIcon}>🌐</span>
            <span>Website</span>
          </button>
          <button className={styles.action} onClick={handleDirections}>
            <span className={styles.actionIcon}>📍</span>
            <span>Directions</span>
          </button>
          <button className={styles.action} onClick={handleShare}>
            <span className={styles.actionIcon}>📤</span>
            <span>Share</span>
          </button>
          <button className={styles.action} onClick={openSharePicker}>
            <span className={styles.actionIcon}>✈️</span>
            <span>Send</span>
          </button>
          <button className={styles.action} onClick={onToggleFavorite || (() => {})}>
            <span className={styles.actionIcon}>{isFavorite ? '★' : '☆'}</span>
            <span>Save</span>
          </button>
        </div>

        {/* Photos */}
        <div className={styles.section}>
          <span className={styles.label}>Photos ({venuePhotos.length})</span>
          {venuePhotos.length > 0 && (
            <div className={styles.photoGrid}>
              {venuePhotos.map((p) => (
                <img key={p.id} src={p.photo_url} alt={p.caption || ''} className={styles.photoThumb} loading="lazy" />
              ))}
            </div>
          )}
          {user && !showPhotoUpload && (
            <button className={styles.addDescBtn} onClick={() => setShowPhotoUpload(true)}>
              + Add a photo
            </button>
          )}
          {showPhotoUpload && user && (
            <PhotoUpload
              userId={user.id}
              onUpload={handlePhotoUploaded}
              onCancel={() => setShowPhotoUpload(false)}
            />
          )}
        </div>

        <div className={styles.divider} />

        {/* Locals Say */}
        <div className={styles.section}>
          <span className={styles.label}>Locals Say ({descriptions.length})</span>
          {descriptions.length === 0 && !showDescForm ? (
            <p className={styles.noReviews}>No descriptions yet — tell people about this spot!</p>
          ) : (
            descriptions.map((d) => (
              <div key={d.id} className={styles.descRow}>
                <p className={styles.descText}>"{d.description_text}"</p>
                <button className={styles.upvoteBtn} onClick={() => handleUpvoteDesc(d.id)}>
                  👍 {d.upvotes}
                </button>
              </div>
            ))
          )}
          {user && !showDescForm && (
            <button className={styles.addDescBtn} onClick={() => setShowDescForm(true)}>
              + Add your description
            </button>
          )}
          {showDescForm && (
            <div className={styles.descForm}>
              <TextArea
                placeholder="How would you describe this spot?"
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                rows={3}
              />
              <div className={styles.descFormActions}>
                <Button size="sm" variant="ghost" onClick={() => setShowDescForm(false)}>Cancel</Button>
                <Button size="sm" onClick={submitDescription} loading={submittingDesc}>Submit</Button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.divider} />

        {/* Reviews */}
        <div className={styles.section}>
          <div className={styles.reviewHeader}>
            <span className={styles.label}>Reviews ({reviews.length})</span>
            {user && !myReview && !showReviewForm && (
              <button className={styles.addDescBtn} onClick={() => setShowReviewForm(true)}>
                + Write Review
              </button>
            )}
          </div>

          {/* Review form */}
          {showReviewForm && (
            <div className={styles.reviewForm}>
              <div className={styles.starPicker}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    className={[styles.starBtn, s <= reviewRating && styles.starActive].filter(Boolean).join(' ')}
                    onClick={() => setReviewRating(s)}
                  >
                    {s <= reviewRating ? '★' : '☆'}
                  </button>
                ))}
              </div>
              <TextArea
                placeholder="Write your review (optional)..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                rows={3}
              />
              <div className={styles.descFormActions}>
                <Button size="sm" variant="ghost" onClick={() => {
                  setShowReviewForm(false);
                  setEditingReview(null);
                  setReviewRating(0);
                  setReviewText('');
                }}>Cancel</Button>
                <Button size="sm" onClick={submitReview} loading={submittingReview}>
                  {editingReview ? 'Update' : 'Post'}
                </Button>
              </div>
            </div>
          )}

          {reviews.length === 0 && !showReviewForm ? (
            <p className={styles.noReviews}>No reviews yet — be the first!</p>
          ) : (
            reviews.slice(0, 10).map((r) => (
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
                {user && r.user_id === user.id && (
                  <div className={styles.reviewActions}>
                    <button className={styles.reviewActionBtn} onClick={() => startEditReview(r)}>Edit</button>
                    <button className={styles.reviewActionBtn} onClick={() => deleteReview(r.id)}>Delete</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className={styles.divider} />

        {/* Send to friend + Report */}
        <div className={styles.section}>
          {user && (
            <button className={styles.addDescBtn} onClick={openSharePicker}>
              💬 Send to a friend
            </button>
          )}
          {user && (
            <button
              className={styles.reportBtn}
              onClick={() => setShowReportForm(!showReportForm)}
            >
              🚩 Report this venue
            </button>
          )}
        </div>

        {/* Share via DM picker */}
        {showSharePicker && (
          <div className={styles.sharePicker}>
            <span className={styles.label}>Send to...</span>
            {loadingContacts ? (
              <div className="skeleton" style={{ height: 44, borderRadius: 12 }} />
            ) : dmContacts.length === 0 ? (
              <p className={styles.noReviews}>Follow people to share venues with them</p>
            ) : (
              dmContacts.map((c) => (
                <button
                  key={c.id}
                  className={styles.contactRow}
                  onClick={() => sendVenueToDm(c.id)}
                >
                  <span className={styles.contactAvatar}>
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" />
                    ) : (
                      (c.display_name || 'U').slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className={styles.contactName}>{c.display_name}</span>
                  <span className={styles.sendIcon}>↗</span>
                </button>
              ))
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowSharePicker(false)}>
              Close
            </Button>
          </div>
        )}

        {/* Report form */}
        {showReportForm && (
          <div className={styles.descForm}>
            <TextArea
              placeholder="Why are you reporting this venue?"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              rows={2}
            />
            <div className={styles.descFormActions}>
              <Button size="sm" variant="ghost" onClick={() => setShowReportForm(false)}>Cancel</Button>
              <Button size="sm" onClick={submitReport}>Report</Button>
            </div>
          </div>
        )}

        {/* Admin editor */}
        {isAdmin && (
          <>
            <div className={styles.divider} />
            <div className={styles.section}>
              <span className={styles.label}>Admin</span>
              {!showAdminEdit ? (
                <button className={styles.addDescBtn} onClick={openAdminEdit}>
                  ✏️ Edit Venue
                </button>
              ) : (
                <div className={styles.adminForm}>
                  <label className={styles.adminLabel}>Name</label>
                  <input
                    className={styles.adminInput}
                    value={adminFields.name}
                    onChange={(e) => setAdminFields((f) => ({ ...f, name: e.target.value }))}
                  />
                  <label className={styles.adminLabel}>When</label>
                  <input
                    className={styles.adminInput}
                    value={adminFields.when_text}
                    onChange={(e) => setAdminFields((f) => ({ ...f, when_text: e.target.value }))}
                  />
                  <label className={styles.adminLabel}>Address</label>
                  <input
                    className={styles.adminInput}
                    value={adminFields.address}
                    onChange={(e) => setAdminFields((f) => ({ ...f, address: e.target.value }))}
                  />
                  <label className={styles.adminLabel}>Deals (one per line)</label>
                  <TextArea
                    value={adminFields.deals}
                    onChange={(e) => setAdminFields((f) => ({ ...f, deals: e.target.value }))}
                    rows={3}
                  />
                  <label className={styles.adminLabel}>Amenities (comma-separated)</label>
                  <input
                    className={styles.adminInput}
                    value={adminFields.amenities}
                    onChange={(e) => setAdminFields((f) => ({ ...f, amenities: e.target.value }))}
                  />
                  <label className={styles.adminLabel}>Photo URL</label>
                  <input
                    className={styles.adminInput}
                    value={adminFields.photo_url}
                    onChange={(e) => setAdminFields((f) => ({ ...f, photo_url: e.target.value }))}
                  />
                  <div className={styles.descFormActions}>
                    <Button size="sm" variant="ghost" onClick={() => setShowAdminEdit(false)}>Cancel</Button>
                    <Button size="sm" onClick={saveAdminEdit} loading={savingAdmin}>Save</Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showPushPrompt && (
        <PushPrompt trigger="action" />
      )}
    </Sheet>
  );
}
