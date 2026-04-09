import { useState, useEffect, useCallback } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { TextArea } from '../../components/ui/Input';
import { PhotoUpload } from '../../components/ui/PhotoUpload';
import { PushPrompt } from '../../components/ui/PushPrompt';
import { Lightbox } from '../../components/ui/Lightbox';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { saveCheckinPhoto } from '../../lib/media';
import { showToast } from '../../components/ui/Toast';
import { haptic } from '../../lib/haptic';
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
  const [guestName, setGuestName] = useState('');
  // Edit review state
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [followingVenue, setFollowingVenue] = useState(false);
  // Share via DM state
  const [showSharePicker, setShowSharePicker] = useState(false);
  const [promoCopied, setPromoCopied] = useState(false);
  const [dmContacts, setDmContacts] = useState<{ id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  // Report state
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  // Photo upload state
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [checkInNote, setCheckInNote] = useState('');
  const [venuePhotos, setVenuePhotos] = useState<{ id: string; photo_url: string; caption: string | null }[]>([]);
  // Push prompt
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  // Going tonight avatars
  const [goingAvatars, setGoingAvatars] = useState<{ user_id: string; display_name: string; avatar_url: string | null; avatar_emoji: string | null }[]>([]);
  // Add-to-list state
  const [showListPicker, setShowListPicker] = useState(false);
  const [userLists, setUserLists] = useState<{ id: string; title: string; cover_emoji: string; hasVenue: boolean }[]>([]);
  // Tag friends after check-in
  const [showTagFriends, setShowTagFriends] = useState(false);
  const [tagFriendsList, setTagFriendsList] = useState<{ id: string; display_name: string; avatar_url: string | null; tagged: boolean }[]>([]);
  // Daily check-in count
  const [todayCheckInCount, setTodayCheckInCount] = useState(0);
  // Admin edit state
  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [adminFields, setAdminFields] = useState({
    name: '', when_text: '', address: '', deals: '', photo_url: '',
    neighborhood: '', cuisine: '', hours: '', url: '', description: '',
    days: [] as string[],
    active: false, featured: false, is_hero: false, owner_verified: false,
    has_happy_hour: false, has_sports_tv: false, is_dog_friendly: false,
    has_live_music: false, has_karaoke: false, has_trivia: false,
    has_bingo: false, has_comedy: false,
  });
  const [savingAdmin, setSavingAdmin] = useState(false);
  // Photo lightbox
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // Events at this venue
  const [venueEvents, setVenueEvents] = useState<{ id: string; name: string; event_type: string; days: string[]; hours: string; price: string; description: string }[]>([]);

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

  const loadVenueEvents = useCallback(async () => {
    if (!venue.name) return;
    const { data } = await supabase
      .from('venues')
      .select('id, name, event_type, days, hours, price, description')
      .ilike('venue_name', venue.name.trim())
      .not('event_type', 'is', null);
    setVenueEvents((data || []) as typeof venueEvents);
  }, [venue.name]);

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
      loadVenueEvents();
      setShowReviewForm(false);
      setEditingReview(null);
      setReviewRating(0);
      setReviewText('');
    }
  }, [open, loadReviews, checkGoing, loadGoingCount, loadGoingAvatars, loadDescriptions, checkVenueFollow, loadVenuePhotos, loadTodayCheckIns, loadUserLists, loadVenueEvents]);

  // Load following list for tag-friends overlay
  const loadTagFriends = useCallback(async () => {
    if (!user) return;
    const { data: follows } = await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', user.id);
    const ids = (follows || []).map((f: { following_id: string }) => f.following_id);
    if (!ids.length) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', ids);
    setTagFriendsList((profiles || []).map((p: { id: string; display_name: string; avatar_url: string | null }) => ({
      id: p.id, display_name: p.display_name, avatar_url: p.avatar_url, tagged: false,
    })));
  }, [user]);

  const tagFriend = async (toUserId: string) => {
    if (!user) return;
    await supabase.from('activity_feed').insert({
      user_id: toUserId,
      activity_type: 'tagged_at',
      venue_id: venue.id,
      venue_name: venue.name,
      neighborhood: venue.neighborhood,
      city_slug: venue.city_slug,
      meta: { tagged_by: user.id },
    });
    setTagFriendsList(prev => prev.map(f => f.id === toUserId ? { ...f, tagged: true } : f));
    showToast({ text: 'Tagged!', type: 'success' });
  };

  // Check and award badges after check-in
  const checkAndAwardBadges = async () => {
    if (!user) return;
    const [checkInsRes, reviewsRes, followingRes, badgesRes] = await Promise.all([
      supabase.from('check_ins').select('venue_id, neighborhood, date, created_at').eq('user_id', user.id),
      supabase.from('reviews').select('id').eq('user_id', user.id),
      supabase.from('user_follows').select('following_id').eq('follower_id', user.id),
      supabase.from('user_badges').select('badge_key').eq('user_id', user.id),
    ]);
    const checkIns = checkInsRes.data || [];
    const reviewCount = (reviewsRes.data || []).length;
    const followingCount = (followingRes.data || []).length;
    const earned = new Set((badgesRes.data || []).map((b: { badge_key: string }) => b.badge_key));
    const award = (key: string) => {
      if (!earned.has(key)) {
        supabase.from('user_badges').insert({ user_id: user!.id, badge_key: key }).then(() => {
          // Log badge to activity_feed (matches vanilla logActivity for badges)
          supabase.from('activity_feed').insert({
            user_id: user!.id,
            activity_type: 'badge',
            venue_id: null,
            venue_name: null,
            neighborhood: null,
            meta: { badge_key: key },
          });
        });
      }
    };
    if (checkIns.length >= 1) award('first_checkin');
    const venueCounts: Record<string, number> = {};
    checkIns.forEach((c: { venue_id: string }) => { venueCounts[c.venue_id] = (venueCounts[c.venue_id] || 0) + 1; });
    if (Object.values(venueCounts).some(c => c >= 3)) award('regular');
    const hoods = new Set(checkIns.map((c: { neighborhood: string | null }) => c.neighborhood).filter(Boolean));
    if (hoods.size >= 5) award('explorer');
    if (reviewCount >= 10) award('critic');
    if (reviewCount >= 25) award('top_reviewer');
    if (followingCount >= 5) award('social');
    // Streak badges — week-over-week consecutive check-ins
    const weekSet = new Set(checkIns.map((c: { date: string | null; created_at: string }) => {
      const d = new Date(c.date || c.created_at);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      return `${d.getFullYear()}-W${Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7)}`;
    }));
    const weeks = [...weekSet].sort();
    let maxStreak = 1, cur = 1;
    for (let i = 1; i < weeks.length; i++) {
      cur = weeks[i] > weeks[i - 1] ? cur + 1 : 1;
      maxStreak = Math.max(maxStreak, cur);
    }
    if (maxStreak >= 4) award('streak_4');
    if (maxStreak >= 8) award('streak_8');
  };

  const handleCheckIn = async () => {
    haptic('light');
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
      const note = checkInNote.trim() || null;
      const date = new Date().toISOString().slice(0, 10);
      await supabase
        .from('check_ins')
        .insert({ venue_id: venue.id, user_id: user.id, city_slug: venue.city_slug, date, note });
      // Log to activity_feed for social feed
      await supabase.from('activity_feed').insert({
        user_id: user.id,
        activity_type: 'check_in',
        venue_id: venue.id,
        venue_name: venue.name,
        neighborhood: venue.neighborhood,
        city_slug: venue.city_slug,
        meta: note ? { note } : null,
      });
      setCheckInNote('');
      setIsGoing(true);
      setGoingCount((c) => c + 1);
      setTodayCheckInCount((c) => c + 1);
      loadGoingAvatars();
      showToast({ text: `Checked in to ${venue.name}!`, type: 'success' });
      // Streak celebration — compute current week streak and show toast if >= 2
      supabase.from('check_ins').select('date, created_at').eq('user_id', user.id).then(({ data: allCi }) => {
        if (!allCi?.length) return;
        const weekSet = new Set(allCi.map((c: { date: string | null; created_at: string }) => {
          const d = new Date(c.date || c.created_at);
          const jan1 = new Date(d.getFullYear(), 0, 1);
          return `${d.getFullYear()}-W${Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7)}`;
        }));
        const weeks = [...weekSet].sort().reverse();
        let streak = 1;
        for (let i = 1; i < weeks.length; i++) {
          if (weeks[i - 1] > weeks[i]) streak++;
          else break;
        }
        if (streak >= 2) {
          setTimeout(() => showToast({ text: `🔥 ${streak}-week streak! Keep it going!`, type: 'success' }), 1500);
        }
      });
      // Badge awarding (background, no await)
      checkAndAwardBadges();
      // Show tag friends overlay
      loadTagFriends().then(() => setShowTagFriends(true));
      // Prompt for push after first check-in
      if (!localStorage.getItem('pushBannerDismissed') && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => setShowPushPrompt(true), 2500);
      }
    }
  };

  const handleDirections = () => {
    const q = encodeURIComponent(`${venue.name}, ${venue.address}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
  };

  const handleShare = async () => {
    haptic('light');
    const appUrl = 'https://apps.apple.com/us/app/spotd/id6760452388';
    const details = [
      venue.name,
      [venue.neighborhood, venue.address].filter(Boolean).join(' — '),
      venue.hours,
      (venue.deals || []).slice(0, 2).join(' · '),
      '',
      `Download Spotd: ${appUrl}`,
    ].filter(Boolean).join('\n');
    if (navigator.share) {
      await navigator.share({ title: venue.name, text: details, url: appUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(`${details}\n${window.location.origin}/?spot=${venue.id}`);
      showToast({ text: 'Link copied!', type: 'success' });
    } else {
      // SMS fallback (matches vanilla)
      window.open(`sms:?body=${encodeURIComponent(details)}`, '_blank');
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
      // Sync upvote count on venue_descriptions (matches vanilla RPC with manual fallback)
      const { data: desc } = await supabase.from('venue_descriptions').select('upvotes').eq('id', descId).single();
      if (desc) await supabase.from('venue_descriptions').update({ upvotes: Math.max(0, (desc.upvotes || 0) - 1) }).eq('id', descId);
      setDescriptions((prev) => prev.map((d) => d.id === descId ? { ...d, upvotes: Math.max(0, d.upvotes - 1) } : d));
    } else {
      await supabase.from('description_upvotes').insert({ user_id: user.id, description_id: descId });
      // Sync upvote count on venue_descriptions (matches vanilla RPC with manual fallback)
      const { data: desc } = await supabase.from('venue_descriptions').select('upvotes').eq('id', descId).single();
      if (desc) await supabase.from('venue_descriptions').update({ upvotes: (desc.upvotes || 0) + 1 }).eq('id', descId);
      setDescriptions((prev) => prev.map((d) => d.id === descId ? { ...d, upvotes: d.upvotes + 1 } : d));
    }
  };

  const submitDescription = async () => {
    if (!user || !descText.trim()) return;
    setSubmittingDesc(true);
    haptic('medium');
    await supabase.from('venue_descriptions').upsert({
      venue_id: venue.id,
      user_id: user.id,
      description_text: descText.trim(),
      tags: [],
    }, { onConflict: 'user_id,venue_id' });
    setDescText('');
    setShowDescForm(false);
    setSubmittingDesc(false);
    loadDescriptions();
    showToast({ text: 'Description added!', type: 'success' });
  };

  const toggleVenueFollow = async () => {
    haptic('light');
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
    const v = venue as Record<string, unknown>;
    setAdminFields({
      name: venue.name,
      when_text: venue.when_text || '',
      address: venue.address || '',
      deals: (venue.deals || []).join('\n'),
      photo_url: venue.photo_url || '',
      neighborhood: (v.neighborhood as string) || '',
      cuisine: (v.cuisine as string) || '',
      hours: (v.hours as string) || '',
      url: (v.url as string) || '',
      description: (v.description as string) || '',
      days: (v.days as string[]) || [],
      active: v.active !== false,
      featured: !!v.featured,
      is_hero: !!v.is_hero,
      owner_verified: !!v.owner_verified,
      has_happy_hour: !!v.has_happy_hour,
      has_sports_tv: !!v.has_sports_tv,
      is_dog_friendly: !!v.is_dog_friendly,
      has_live_music: !!v.has_live_music,
      has_karaoke: !!v.has_karaoke,
      has_trivia: !!v.has_trivia,
      has_bingo: !!v.has_bingo,
      has_comedy: !!v.has_comedy,
    });
    setShowAdminEdit(true);
  };

  const saveAdminEdit = async () => {
    if (!isAdmin) return;
    if (!adminFields.name.trim()) { showToast({ text: 'Name is required', type: 'error' }); return; }
    setSavingAdmin(true);
    const updates: Record<string, unknown> = {
      name: adminFields.name.trim(),
      when_text: adminFields.when_text.trim(),
      address: adminFields.address.trim() || null,
      deals: adminFields.deals.split('\n').map((d) => d.trim()).filter(Boolean),
      photo_url: adminFields.photo_url.trim() || null,
      neighborhood: adminFields.neighborhood.trim() || null,
      cuisine: adminFields.cuisine.trim() || null,
      hours: adminFields.hours.trim() || null,
      url: adminFields.url.trim() || null,
      description: adminFields.description.trim() || null,
      days: adminFields.days.length ? adminFields.days : [],
      active: adminFields.active,
      featured: adminFields.featured,
      is_hero: adminFields.is_hero,
      owner_verified: adminFields.owner_verified,
      has_happy_hour: adminFields.has_happy_hour,
      has_sports_tv: adminFields.has_sports_tv,
      is_dog_friendly: adminFields.is_dog_friendly,
      has_live_music: adminFields.has_live_music,
      has_karaoke: adminFields.has_karaoke,
      has_trivia: adminFields.has_trivia,
      has_bingo: adminFields.has_bingo,
      has_comedy: adminFields.has_comedy,
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
    haptic('medium');
    if (reviewRating === 0) {
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
        user_id: user?.id || null,
        rating: reviewRating,
        text: reviewText.trim(),
        name: user ? undefined : (guestName.trim() || 'Anonymous'),
      });
      // Log to activity_feed (only for logged-in users)
      if (user) {
        await supabase.from('activity_feed').insert({
          user_id: user.id,
          activity_type: 'review',
          venue_id: venue.id,
          venue_name: venue.name,
          neighborhood: venue.neighborhood,
          city_slug: venue.city_slug,
          meta: { rating: reviewRating, note: reviewText.trim() },
        });
      }
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
              haptic('medium');
              navigator.clipboard.writeText(venue.promo_code!).then(() => {
                setPromoCopied(true);
                showToast({ text: 'Promo code copied!', type: 'success' });
                setTimeout(() => setPromoCopied(false), 2000);
              }).catch(() => {
                showToast({ text: 'Could not copy', type: 'error' });
              });
            }}>
              <div>
                <span className={styles.promoLabel}>Promo Code</span>
                <span className={styles.promoCode}>{venue.promo_code}</span>
                {venue.promo_description && <span className={styles.promoDesc}>{venue.promo_description}</span>}
              </div>
              <span className={styles.promoCopy}>{promoCopied ? '✓ Copied!' : '📋 Copy'}</span>
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

        {/* Events at this venue */}
        {venueEvents.length > 0 && (
          <>
            <div className={styles.divider} />
            <div className={styles.section}>
              <span className={styles.label}>Events at this venue</span>
              <div className={styles.venueEventsList}>
                {venueEvents.map((ev) => {
                  const evToday = (ev.days || []).some((d: string) => d.toLowerCase() === todayDay);
                  return (
                    <div key={ev.id} className={styles.venueEventItem}>
                      <div className={styles.venueEventTop}>
                        <span className={styles.venueEventName}>{ev.name || ev.event_type}</span>
                        <span className={styles.venueEventType}>{ev.event_type || ''}</span>
                        {evToday && <span className={styles.venueEventTonight}>TONIGHT</span>}
                      </div>
                      <div className={styles.venueEventMeta}>
                        {(ev.days || []).join(', ')} · {ev.hours || ''}{ev.price && ev.price !== 'Free' ? ` · ${ev.price}` : ' · Free'}
                      </div>
                      {ev.description && <div className={styles.venueEventDesc}>{ev.description}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className={styles.divider} />

        {/* Going button with optional note */}
        <div className={styles.goingWrap}>
          {user && !isGoing && todayCheckInCount < 5 && (
            <input
              className={styles.checkInNoteInput}
              placeholder="Add a note (optional)..."
              value={checkInNote}
              onChange={e => setCheckInNote(e.target.value)}
              maxLength={280}
            />
          )}
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
              {venuePhotos.map((p, i) => (
                <img
                  key={p.id}
                  src={p.photo_url}
                  alt={p.caption || ''}
                  className={styles.photoThumb}
                  loading="lazy"
                  onClick={() => setLightboxIdx(i)}
                />
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
            {!myReview && !showReviewForm && (
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
              {!user && (
                <input
                  className={styles.adminInput}
                  placeholder="Your name (optional)"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
              )}
              <TextArea
                placeholder="Write your review (optional)..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                rows={3}
              />
              {!user && (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
                  Posting as guest — sign in to manage reviews
                </p>
              )}
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
                  <input className={styles.adminInput} value={adminFields.name} onChange={(e) => setAdminFields((f) => ({ ...f, name: e.target.value }))} />

                  <label className={styles.adminLabel}>Neighborhood</label>
                  <input className={styles.adminInput} value={adminFields.neighborhood} onChange={(e) => setAdminFields((f) => ({ ...f, neighborhood: e.target.value }))} />

                  <label className={styles.adminLabel}>Address</label>
                  <input className={styles.adminInput} value={adminFields.address} onChange={(e) => setAdminFields((f) => ({ ...f, address: e.target.value }))} />

                  <label className={styles.adminLabel}>Hours</label>
                  <input className={styles.adminInput} value={adminFields.hours} placeholder="4pm - 7pm" onChange={(e) => setAdminFields((f) => ({ ...f, hours: e.target.value }))} />

                  <label className={styles.adminLabel}>Days</label>
                  <div className={styles.daysPicker}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={[styles.dayBtn, adminFields.days.includes(d.toLowerCase()) && styles.dayBtnSel].filter(Boolean).join(' ')}
                        onClick={() => setAdminFields((f) => ({
                          ...f,
                          days: f.days.includes(d.toLowerCase())
                            ? f.days.filter((x) => x !== d.toLowerCase())
                            : [...f.days, d.toLowerCase()],
                        }))}
                      >{d}</button>
                    ))}
                  </div>

                  <label className={styles.adminLabel}>When Text</label>
                  <input className={styles.adminInput} value={adminFields.when_text} onChange={(e) => setAdminFields((f) => ({ ...f, when_text: e.target.value }))} />

                  <label className={styles.adminLabel}>Deals (one per line)</label>
                  <TextArea value={adminFields.deals} onChange={(e) => setAdminFields((f) => ({ ...f, deals: e.target.value }))} rows={3} />

                  <label className={styles.adminLabel}>Cuisine / Type</label>
                  <input className={styles.adminInput} value={adminFields.cuisine} onChange={(e) => setAdminFields((f) => ({ ...f, cuisine: e.target.value }))} />

                  <label className={styles.adminLabel}>Website URL</label>
                  <input className={styles.adminInput} value={adminFields.url} placeholder="https://..." onChange={(e) => setAdminFields((f) => ({ ...f, url: e.target.value }))} />

                  <label className={styles.adminLabel}>Description</label>
                  <TextArea value={adminFields.description} onChange={(e) => setAdminFields((f) => ({ ...f, description: e.target.value }))} rows={2} />

                  <label className={styles.adminLabel}>Photo URL</label>
                  <input className={styles.adminInput} value={adminFields.photo_url} onChange={(e) => setAdminFields((f) => ({ ...f, photo_url: e.target.value }))} />

                  <label className={styles.adminLabel}>Visibility</label>
                  <div className={styles.adminChecks}>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.active} onChange={(e) => setAdminFields((f) => ({ ...f, active: e.target.checked }))} /> Active</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.featured} onChange={(e) => setAdminFields((f) => ({ ...f, featured: e.target.checked }))} /> Featured</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.is_hero} onChange={(e) => setAdminFields((f) => ({ ...f, is_hero: e.target.checked }))} /> Hero Card</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.owner_verified} onChange={(e) => setAdminFields((f) => ({ ...f, owner_verified: e.target.checked }))} /> Owner Verified</label>
                  </div>

                  <label className={styles.adminLabel}>Amenities</label>
                  <div className={styles.adminChecks}>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_happy_hour} onChange={(e) => setAdminFields((f) => ({ ...f, has_happy_hour: e.target.checked }))} /> 🍺 Happy Hour</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_sports_tv} onChange={(e) => setAdminFields((f) => ({ ...f, has_sports_tv: e.target.checked }))} /> 📺 Sports TV</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.is_dog_friendly} onChange={(e) => setAdminFields((f) => ({ ...f, is_dog_friendly: e.target.checked }))} /> 🐶 Dog Friendly</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_live_music} onChange={(e) => setAdminFields((f) => ({ ...f, has_live_music: e.target.checked }))} /> 🎵 Live Music</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_karaoke} onChange={(e) => setAdminFields((f) => ({ ...f, has_karaoke: e.target.checked }))} /> 🎤 Karaoke</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_trivia} onChange={(e) => setAdminFields((f) => ({ ...f, has_trivia: e.target.checked }))} /> 🧠 Trivia</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_bingo} onChange={(e) => setAdminFields((f) => ({ ...f, has_bingo: e.target.checked }))} /> 🎯 Bingo</label>
                    <label className={styles.adminCheck}><input type="checkbox" checked={adminFields.has_comedy} onChange={(e) => setAdminFields((f) => ({ ...f, has_comedy: e.target.checked }))} /> 🎭 Comedy</label>
                  </div>

                  <div className={styles.descFormActions}>
                    <Button size="sm" variant="ghost" onClick={() => setShowAdminEdit(false)}>Cancel</Button>
                    <Button size="sm" onClick={saveAdminEdit} loading={savingAdmin}>Save Changes</Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tag friends overlay */}
      {showTagFriends && tagFriendsList.length > 0 && (
        <div className={styles.tagOverlay}>
          <div className={styles.tagTitle}>Tag a friend at {venue.name}</div>
          <div className={styles.tagSub}>They&apos;ll see it in their feed</div>
          <div className={styles.tagGrid}>
            {tagFriendsList.map(f => (
              <button
                key={f.id}
                className={[styles.tagChip, f.tagged && styles.tagChipTagged].filter(Boolean).join(' ')}
                onClick={() => !f.tagged && tagFriend(f.id)}
              >
                <span className={styles.tagChipAvatar}>
                  {f.avatar_url ? <img src={f.avatar_url} alt="" /> : f.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span className={styles.tagChipName}>{f.display_name}</span>
                {f.tagged && <span>✓</span>}
              </button>
            ))}
          </div>
          <button className={styles.tagSkip} onClick={() => setShowTagFriends(false)}>Skip</button>
        </div>
      )}

      {showPushPrompt && (
        <PushPrompt trigger="action" />
      )}

      {lightboxIdx !== null && venuePhotos.length > 0 && (
        <Lightbox
          src={venuePhotos[lightboxIdx].photo_url}
          images={venuePhotos.map(p => p.photo_url)}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </Sheet>
  );
}
