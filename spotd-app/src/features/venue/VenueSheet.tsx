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
  // Going tonight avatars
  const [goingAvatars, setGoingAvatars] = useState<{ user_id: string; display_name: string; avatar_url: string | null; avatar_emoji: string | null }[]>([]);
  // Add-to-list state
  const [showListPicker, setShowListPicker] = useState(false);
  const [userLists, setUserLists] = useState<{ id: string; title: string; cover_emoji: string; hasVenue: boolean }[]>([]);
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

  const loadGoingAvatars = useCallback(async () => {
    const { data } = await supabase
      .from('check_ins')
      .select('user_id')
      .eq('venue_id', venue.id)
      .gte('created_at', today + 'T00:00:00');
    const userIds = [...new Set((data || []).map((r: { user_id: string }) => r.user_id))];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, avatar_emoji')
        .in('id', userIds);
      setGoingAvatars((profiles || []).map((p: { id: string; display_name: string; avatar_url: string | null; avatar_emoji: string | null }) => ({
        user_id: p.id, display_name: p.display_name, avatar_url: p.avatar_url, avatar_emoji: p.avatar_emoji,
      })));
    } else {
      setGoingAvatars([]);
    }
  }, [venue.id, today]);

  const loadUserLists = useCallback(async () => {
    if (!user) return;
    const { data: lists } = await supabase
      .from('user_lists')
      .select('id, title, cover_emoji')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (!lists?.length) { setUserLists([]); return; }
    const listIds = lists.map((l: { id: string }) => l.id);
    const { data: items } = await supabase
      .from('list_items')
      .select('list_id')
      .eq('venue_id', venue.id)
      .in('list_id', listIds);
    const hasVenueSet = new Set((items || []).map((i: { list_id: string }) => i.list_id));
    setUserLists(lists.map((l: { id: string; title: string; cover_emoji: string }) => ({
      ...l, hasVenue: hasVenueSet.has(l.id),
    })));
  }, [user, venue.id]);

  useEffect(() => {
    if (open) {
      loadReviews();
      loadTodayCheckIns();
      checkGoing();
      loadGoingCount();
      loadGoingAvatars();
      loadDescriptions();
      checkVenueFollow();
      loadVenuePhotos();
      loadUserLists();
      setShowReviewForm(false);
      setEditingReview(null);
      setReviewRating(0);
      setReviewText('');
    }
  }, [open, loadReviews, checkGoing, loadGoingCount, loadGoingAvatars, loadDescriptions, checkVenueFollow, loadVenuePhotos, loadTodayCheckIns, loadUserLists]);

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
      // Log to activity_feed for social feed
      await supabase.from('activity_feed').insert({
        user_id: user.id,
        activity_type: 'check_in',
        venue_id: venue.id,
        venue_name: venue.name,
        neighborhood: venue.neighborhood,
        city_slug: venue.city_slug,
      });
      setIsGoing(true);
      setGoingCount((c) => c + 1);
      setTodayCheckInCount((c) => c + 1);
      loadGoingAvatars();
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
    await supabase.from('venue_descriptions').upsert({
      venue_id: venue.id,
      user_id: user.id,
      description_text: descText.trim(),
    }, { onConflict: 'user_id,venue_id' });
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

  // --- Add to List ---
  const toggleListItem = async (listId: string, hasVenue: boolean) => {
    if (!user) return;
    if (hasVenue) {
      await supabase.from('list_items').delete().eq('list_id', listId).eq('venue_id', venue.id);
    } else {
      await supabase.from('list_items').insert({ list_id: listId, venue_id: venue.id });
    }
    setUserLists(prev => prev.map(l => l.id === listId ? { ...l, hasVenue: !hasVenue } : l));
    showToast({ text: hasVenue ? 'Removed from list' : 'Added to list!', type: 'success' });
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
      // Log to activity_feed
      await supabase.from('activity_feed').insert({
        user_id: user.id,
        activity_type: 'review',
        venue_id: venue.id,
        venue_name: venue.name,
        neighborhood: venue.neighborhood,
        city_slug: venue.city_slug,
        meta: { rating: reviewRating, note: reviewText.trim() },
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

        {/* Promo Code */}
        {venue.promo_code && (
          <div className={styles.promoBox}>
            <div className={styles.promoInner} onClick={() => {
              navigator.clipboard.writeText(venue.promo_code!);
              showToast({ text: 'Promo code copied!', type: 'success' });
            }}>
              <div>
                <span className={styles.promoLabel}>Promo Code</span>
                <span className={styles.promoCode}>{venue.promo_code}</span>
                {venue.promo_description && <span className={styles.promoDesc}>{venue.promo_description}</span>}
              </div>
              <span className={styles.promoCopy}>📋 Copy</span>
            </div>
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
          {goingAvatars.length > 0 && (
            <div className={styles.goingAvatars}>
              {goingAvatars.slice(0, 8).map((a) => (
                <span key={a.user_id} className={styles.goingAvatar} title={a.display_name}>
                  {a.avatar_url ? (
                    <img src={a.avatar_url} alt="" />
                  ) : (
                    <span>{a.avatar_emoji || (a.display_name || '?').slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
              ))}
              {goingAvatars.length > 8 && <span className={styles.goingMore}>+{goingAvatars.length - 8}</span>}
            </div>
          )}
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

        {/* Add to List picker */}
        {showListPicker && user && (
          <div className={styles.sharePicker}>
            <span className={styles.label}>Add to list</span>
            {userLists.length === 0 ? (
              <p className={styles.noReviews}>No lists yet — create one from your profile</p>
            ) : (
              userLists.map((l) => (
                <button
                  key={l.id}
                  className={styles.contactRow}
                  onClick={() => toggleListItem(l.id, l.hasVenue)}
                >
                  <span className={styles.contactAvatar}>{l.cover_emoji || '📋'}</span>
                  <span className={styles.contactName}>{l.title}</span>
                  <span className={styles.sendIcon}>{l.hasVenue ? '✓' : '+'}</span>
                </button>
              ))
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowListPicker(false)}>Close</Button>
          </div>
        )}

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

        {/* Rating Summary */}
        {(venue.avg_rating || venue.yelp_rating || reviews.length > 0) && (() => {
          const avgRating = reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : (venue.avg_rating || venue.yelp_rating || 0);
          const totalReviews = (venue.review_count || 0) + reviews.length;
          return (
            <div className={styles.ratingSummary}>
              <span className={styles.ratingBig}>{avgRating.toFixed(1)}</span>
              <div className={styles.ratingRight}>
                <span className={styles.ratingStars}>{'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}</span>
                <span className={styles.ratingCount}>{totalReviews} review{totalReviews !== 1 ? 's' : ''}</span>
              </div>
            </div>
          );
        })()}

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

        {/* Send to friend + Add to List + Report */}
        <div className={styles.section}>
          {user && (
            <button className={styles.addDescBtn} onClick={openSharePicker}>
              💬 Send to a friend
            </button>
          )}
          {user && (
            <button className={styles.addDescBtn} onClick={() => setShowListPicker(!showListPicker)}>
              📋 Add to a list
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
