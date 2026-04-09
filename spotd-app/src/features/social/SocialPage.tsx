import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../../components/ui/Sheet';
import { Lightbox } from '../../components/ui/Lightbox';
import { useAuth } from '../../contexts/AuthContext';
import { useCity } from '../../contexts/CityContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import styles from './SocialPage.module.css';

interface FeedItem {
  id: string;
  user_id: string;
  type: string;
  venue_id: string | null;
  venue_name: string | null;
  neighborhood: string | null;
  caption: string | null;
  photo_url: string | null;
  rating: number | null;
  created_at: string;
  isFollowing: boolean;
  display_name: string;
  avatar_url: string | null;
  avatar_emoji: string | null;
  likeCount: number;
  liked: boolean;
  commentCount: number;
}

interface Comment {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
  display_name?: string;
}

type SocialTab = 'following' | 'public';

function AutoPlayVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <video ref={ref} src={src} className={className} loop muted playsInline preload="metadata" />;
}

export default function SocialPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCity } = useCity();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SocialTab>('following');
  const [commentSheetPost, setCommentSheetPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

    const citySlug = currentCity.slug;

    // Get following IDs
    let followingIds: string[] = [];
    if (user) {
      const { data: follows } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id);
      followingIds = (follows || []).map((f: { following_id: string }) => f.following_id);
    }
    const followSet = new Set(followingIds);

    // Fetch from 3 tables in parallel (matches legacy fetchSocialFeed)
    const [photosRes, activityRes, checkInsRes] = await Promise.all([
      supabase
        .from('checkin_photos')
        .select('id, user_id, venue_id, venue_name, neighborhood, caption, photo_url, created_at')
        .eq('city_slug', citySlug)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('activity_feed')
        .select('id, user_id, activity_type, venue_id, venue_name, neighborhood, meta, created_at')
        .eq('city_slug', citySlug)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('check_ins')
        .select('id, user_id, venue_id, venue_name, neighborhood, date, created_at')
        .eq('city_slug', citySlug)
        .order('created_at', { ascending: false })
        .limit(60),
    ]);

    const photos = photosRes.data || [];
    const activities = activityRes.data || [];
    const checkIns = checkInsRes.data || [];

    // Deduplicate: skip check_ins that also have a photo
    const photoVenueUserPairs = new Set(
      photos.map((p: { user_id: string; venue_id: string }) => `${p.user_id}_${p.venue_id}`)
    );

    const merged: FeedItem[] = [];

    // Add photos
    photos.forEach((p: { id: string; user_id: string; venue_id: string; venue_name: string; neighborhood: string; caption: string; photo_url: string; created_at: string }) => {
      merged.push({
        id: p.id,
        user_id: p.user_id,
        type: 'photo',
        venue_id: p.venue_id,
        venue_name: p.venue_name,
        neighborhood: p.neighborhood,
        caption: p.caption,
        photo_url: p.photo_url,
        rating: null,
        created_at: p.created_at,
        isFollowing: followSet.has(p.user_id),
        display_name: '',
        avatar_url: null,
        avatar_emoji: null,
        likeCount: 0,
        liked: false,
        commentCount: 0,
      });
    });

    // Add activity items
    activities.forEach((a: { id: string; user_id: string; activity_type: string; venue_id: string; venue_name: string; neighborhood: string; meta: { photo_url?: string; rating?: number; note?: string } | null; created_at: string }) => {
      const meta = a.meta || {};
      merged.push({
        id: a.id,
        user_id: a.user_id,
        type: a.activity_type || 'check_in',
        venue_id: a.venue_id,
        venue_name: a.venue_name,
        neighborhood: a.neighborhood,
        caption: meta.note || null,
        photo_url: meta.photo_url || null,
        rating: meta.rating || null,
        created_at: a.created_at,
        isFollowing: followSet.has(a.user_id),
        display_name: '',
        avatar_url: null,
        avatar_emoji: null,
        likeCount: 0,
        liked: false,
        commentCount: 0,
      });
    });

    // Add check-ins (deduplicated)
    checkIns.forEach((c: { id: string; user_id: string; venue_id: string; venue_name: string; neighborhood: string; created_at: string }) => {
      if (!photoVenueUserPairs.has(`${c.user_id}_${c.venue_id}`)) {
        merged.push({
          id: c.id,
          user_id: c.user_id,
          type: 'check_in',
          venue_id: c.venue_id,
          venue_name: c.venue_name,
          neighborhood: c.neighborhood,
          caption: null,
          photo_url: null,
          rating: null,
          created_at: c.created_at,
          isFollowing: followSet.has(c.user_id),
          display_name: '',
          avatar_url: null,
          avatar_emoji: null,
          likeCount: 0,
          liked: false,
          commentCount: 0,
        });
      }
    });

    // Sort: following first, then by recency
    merged.sort((a, b) => {
      const aFollow = a.isFollowing ? 1 : 0;
      const bFollow = b.isFollowing ? 1 : 0;
      if (aFollow !== bFollow) return bFollow - aFollow;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Hydrate profiles
    const userIds = [...new Set(merged.map(m => m.user_id))];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, avatar_emoji')
        .in('id', userIds);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string; avatar_url: string; avatar_emoji: string }) => [p.id, p]));
      merged.forEach(m => {
        const prof = pMap.get(m.user_id);
        if (prof) {
          m.display_name = prof.display_name || '';
          m.avatar_url = prof.avatar_url;
          m.avatar_emoji = prof.avatar_emoji;
        }
      });
    }

    // Hydrate likes & comments
    const postIds = merged.map(m => m.id).filter(Boolean);
    if (postIds.length) {
      const [likesRes, commentsRes] = await Promise.all([
        supabase.from('social_likes').select('post_id, user_id').in('post_id', postIds),
        supabase.from('social_comments').select('post_id').in('post_id', postIds),
      ]);
      const likes = likesRes.data || [];
      const commentRows = commentsRes.data || [];

      const likeMap: Record<string, string[]> = {};
      likes.forEach((l: { post_id: string; user_id: string }) => {
        (likeMap[l.post_id] = likeMap[l.post_id] || []).push(l.user_id);
      });
      const commentMap: Record<string, number> = {};
      commentRows.forEach((c: { post_id: string }) => {
        commentMap[c.post_id] = (commentMap[c.post_id] || 0) + 1;
      });

      merged.forEach(m => {
        const likers = likeMap[m.id] || [];
        m.likeCount = likers.length;
        m.liked = user ? likers.includes(user.id) : false;
        m.commentCount = commentMap[m.id] || 0;
      });
    }

    setItems(merged);
    setLoading(false);
  }, [currentCity, user]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const toggleLike = async (postId: string, postType: string) => {
    if (!user) { showToast({ text: 'Sign in to like posts', type: 'error' }); return; }
    const item = items.find(i => i.id === postId);
    if (!item) return;

    if (item.liked) {
      await supabase.from('social_likes').delete().eq('user_id', user.id).eq('post_id', postId);
    } else {
      await supabase.from('social_likes').insert({ user_id: user.id, post_id: postId, post_type: postType });
    }
    setItems(prev => prev.map(i =>
      i.id === postId ? { ...i, liked: !i.liked, likeCount: i.liked ? i.likeCount - 1 : i.likeCount + 1 } : i
    ));
  };

  const openComments = async (postId: string) => {
    setCommentSheetPost(postId);
    setLoadingComments(true);
    const { data } = await supabase
      .from('social_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    const raw = (data || []) as Comment[];
    const uids = [...new Set(raw.map(c => c.user_id))];
    if (uids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', uids);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
      raw.forEach(c => { c.display_name = pMap.get(c.user_id) || 'User'; });
    }
    setComments(raw);
    setLoadingComments(false);
  };

  const submitComment = async () => {
    if (!user || !commentInput.trim() || !commentSheetPost) return;
    const text = commentInput.trim();
    setCommentInput('');
    await supabase.from('social_comments').insert({
      post_id: commentSheetPost,
      post_type: 'social',
      user_id: user.id,
      text,
    });
    setItems(prev => prev.map(i =>
      i.id === commentSheetPost ? { ...i, commentCount: i.commentCount + 1 } : i
    ));
    openComments(commentSheetPost);
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const actionVerbs: Record<string, string> = {
    photo: 'checked in at',
    check_in: 'checked in at',
    review: 'reviewed',
    favorite: 'saved',
    going_tonight: 'is going to',
    tagged_at: 'was tagged at',
  };

  const initials = (name: string) =>
    name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  const isVideo = (url: string | null) => url && /\.(mp4|webm|mov)(\?|$)/i.test(url);

  // Filter based on active sub-tab
  const filtered = activeTab === 'following'
    ? items.filter(i => i.isFollowing)
    : items.filter(i => !i.isFollowing);

  const renderItem = (item: FeedItem, variant: 'hero' | 'compact' | 'wide') => {
    const displayName = item.display_name || 'Someone';
    const venueName = item.venue_name || 'a spot';
    const verb = actionVerbs[item.type] || 'visited';
    const suffix = item.type === 'going_tonight' ? ' tonight' : '';
    const ta = timeAgo(item.created_at);

    const avatarEl = item.avatar_url
      ? <img src={item.avatar_url} alt="" className={styles.avatarImg} />
      : <span className={styles.initials}>{item.avatar_emoji || initials(displayName)}</span>;

    const actionBtns = (
      <div className={styles.sfActions}>
        <button
          className={[styles.sfActionBtn, item.liked && styles.sfLiked].filter(Boolean).join(' ')}
          onClick={(e) => { e.stopPropagation(); toggleLike(item.id, item.type); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={item.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          {item.likeCount > 0 && <span>{item.likeCount}</span>}
        </button>
        <button
          className={styles.sfActionBtn}
          onClick={(e) => { e.stopPropagation(); openComments(item.id); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          {item.commentCount > 0 && <span>{item.commentCount}</span>}
        </button>
      </div>
    );

    if (variant === 'hero' && item.photo_url) {
      return (
        <div key={item.id} className={styles.sfHero}>
          <div className={styles.sfHeroMedia} onClick={() => !isVideo(item.photo_url) && setLightboxSrc(item.photo_url)}>
            {isVideo(item.photo_url) ? (
              <AutoPlayVideo src={item.photo_url!} className={styles.sfHeroImg} />
            ) : (
              <img className={styles.sfHeroImg} src={item.photo_url} alt={venueName} loading="lazy" />
            )}
            <div className={styles.sfHeroGrad} />
          </div>
          <div className={styles.sfHeroInfo}>
            <div className={styles.sfHeroUser}>
              <div className={styles.sfHeroAvatar}>{avatarEl}</div>
              <span className={styles.sfHeroName}>{displayName}</span>
            </div>
            <div className={styles.sfHeroVenue}>{venueName}</div>
            <div className={styles.sfHeroMeta}>
              {item.neighborhood && <><span>{item.neighborhood}</span><span className={styles.sfDot} /></>}
              <span>{ta}</span>
            </div>
            {item.caption && <div className={styles.sfHeroCaption}>{item.caption}</div>}
            {item.rating ? <div className={styles.sfStars}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</div> : null}
          </div>
          {actionBtns}
        </div>
      );
    }

    if (variant === 'compact') {
      return (
        <div key={item.id} className={styles.sfCompact}>
          <div className={styles.sfCompactHeader}>
            <div className={styles.sfCompactAvatar}>{avatarEl}</div>
            <span className={styles.sfCompactName}>{displayName}</span>
          </div>
          <div className={styles.sfCompactBody}>
            <div className={styles.sfCompactVenue}>{venueName}</div>
            {item.rating ? <div className={styles.sfStars}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</div> : null}
            {item.caption && <div className={styles.sfCompactCaption}>{item.caption}</div>}
            <div className={styles.sfCompactMeta}>{item.neighborhood || ta}</div>
          </div>
          <div className={styles.sfCompactActions}>
            <button
              className={[styles.sfActionBtn, item.liked && styles.sfLiked].filter(Boolean).join(' ')}
              onClick={(e) => { e.stopPropagation(); toggleLike(item.id, item.type); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={item.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
              {item.likeCount > 0 && <span>{item.likeCount}</span>}
            </button>
            <button className={styles.sfActionBtn} onClick={(e) => { e.stopPropagation(); openComments(item.id); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {item.commentCount > 0 && <span>{item.commentCount}</span>}
            </button>
          </div>
        </div>
      );
    }

    // Wide variant
    return (
      <div key={item.id} className={styles.sfWide}>
        <div className={styles.sfWideHeader}>
          <div className={styles.sfWideAvatar}>{avatarEl}</div>
          <span className={styles.sfWideName}>{displayName}</span>
        </div>
        <div className={styles.sfWideBody}>
          <div className={styles.sfWideHeadline}>
            <span className={styles.sfWideBoldName}>{displayName}</span>{' '}
            <span className={styles.sfWideVerb}>{verb}</span>{' '}
            <span className={styles.sfWideVenue}>{venueName}</span>{suffix}
          </div>
          {item.rating ? <div className={styles.sfStars}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</div> : null}
          {item.caption && <div className={styles.sfWideCaption}>&ldquo;{item.caption}&rdquo;</div>}
          <div className={styles.sfWideMeta}>{item.neighborhood ? `${item.neighborhood} · ` : ''}{ta}</div>
        </div>
        {actionBtns}
      </div>
    );
  };

  // Build masonry layout (matching vanilla renderSocialTab)
  const renderFeed = () => {
    if (loading) {
      return Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`skeleton ${styles.skeleton}`} />
      ));
    }

    if (activeTab === 'following' && !filtered.length) {
      return (
        <div className={styles.empty}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-1a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          <div className={styles.emptyTitle}>Follow people to see their activity</div>
          <p>When you follow someone, their check-ins and photos show up here.</p>
        </div>
      );
    }

    if (!filtered.length) {
      return (
        <div className={styles.empty}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          <div className={styles.emptyTitle}>Nothing here yet</div>
          <p>Be the first to check in and share a photo tonight</p>
        </div>
      );
    }

    // Masonry: photo posts → hero, text posts → batched 2-up compact with occasional wide
    const elements: React.JSX.Element[] = [];
    let textBatch: FeedItem[] = [];
    let batchIdx = 0;

    const flushText = () => {
      while (textBatch.length > 0) {
        if (textBatch.length >= 2 && batchIdx % 3 !== 2) {
          const a = textBatch.shift()!;
          const b = textBatch.shift()!;
          elements.push(
            <div key={`row-${a.id}`} className={styles.sfCompactRow}>
              {renderItem(a, 'compact')}
              {renderItem(b, 'compact')}
            </div>
          );
        } else {
          elements.push(renderItem(textBatch.shift()!, 'wide'));
        }
        batchIdx++;
      }
    };

    filtered.forEach(item => {
      const hasMedia = item.type === 'photo' || item.photo_url;
      if (hasMedia) {
        flushText();
        elements.push(renderItem(item, 'hero'));
      } else {
        textBatch.push(item);
      }
    });
    flushText();

    return elements;
  };

  return (
    <div className={styles.page}>
      {/* Header with logo + action buttons (matches vanilla social header) */}
      <div className={styles.socialHeader}>
        <img src="/spotd_logo_v5.png" alt="Spotd" className={styles.headerLogo} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className={styles.headerActions}>
          <button className={styles.headerBtn} onClick={() => navigate('/dms')} title="Messages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </button>
          <button className={styles.headerBtn} onClick={() => navigate('/find-people')} title="Find people">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </button>
          <button className={styles.headerBtn} onClick={() => navigate('/notifications')} title="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
          </button>
          <button className={styles.headerBtn} onClick={() => navigate('/?addspot=1')} title="Add a spot">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <button className={styles.headerBtn} onClick={() => loadFeed()} title="Refresh">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
        </div>
      </div>

      {/* Following / Public sub-tabs */}
      <div className={styles.subTabs}>
        <div className={styles.subTabsInner}>
          <button
            className={[styles.subTab, activeTab === 'following' && styles.subTabActive].filter(Boolean).join(' ')}
            onClick={() => setActiveTab('following')}
          >Following</button>
          <button
            className={[styles.subTab, activeTab === 'public' && styles.subTabActive].filter(Boolean).join(' ')}
            onClick={() => setActiveTab('public')}
          >Public</button>
        </div>
      </div>

      <div className={styles.feed}>
        {renderFeed()}
      </div>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      <Sheet open={!!commentSheetPost} onClose={() => { setCommentSheetPost(null); setComments([]); }}>
        <div className={styles.commentsSheet}>
          <span className={styles.commentsTitle}>Comments</span>
          {loadingComments ? (
            <div className="skeleton" style={{ height: 60, borderRadius: 12 }} />
          ) : comments.length === 0 ? (
            <p className={styles.noComments}>No comments yet — be the first</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className={styles.commentRow}>
                <span className={styles.commentName}>{c.display_name || 'User'}</span>
                <p className={styles.commentBody}>{c.text}</p>
                <span className={styles.commentTime}>{timeAgo(c.created_at)}</span>
              </div>
            ))
          )}
          {user && (
            <div className={styles.commentCompose}>
              <input
                className={styles.commentInput}
                value={commentInput}
                onChange={e => setCommentInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitComment()}
                placeholder="Add a comment..."
                maxLength={280}
              />
              <button className={styles.commentSend} onClick={submitComment}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
