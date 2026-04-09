import { useState, useEffect, useCallback } from 'react';
import { CityBar } from '../../components/layout/CityBar';
import { Sheet } from '../../components/ui/Sheet';
import { Lightbox } from '../../components/ui/Lightbox';
import { useAuth } from '../../contexts/AuthContext';
import { useCity } from '../../contexts/CityContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import styles from './SocialPage.module.css';

interface FeedPost {
  id: string;
  user_id: string;
  type: string;
  content: string | null;
  photo_url: string | null;
  venue_name: string | null;
  venue_id: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  display_name?: string;
  avatar_url?: string | null;
  isFollowing?: boolean;
}

interface Comment {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
  display_name?: string;
}

export default function SocialPage() {
  const { user } = useAuth();
  const { currentCity } = useCity();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [commentSheetPost, setCommentSheetPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

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

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    // Parallel fetch — same as legacy fetchSocialFeed
    const [photosRes, activityRes, goingRes] = await Promise.allSettled([
      supabase
        .from('checkin_photos')
        .select('id, user_id, venue_id, photo_url, caption, city_slug, created_at')
        .eq('city_slug', currentCity.slug)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('activity_feed')
        .select('id, user_id, activity_type, venue_id, venue_name, neighborhood, meta, created_at')
        .in('activity_type', ['check_in', 'review', 'favorite', 'tagged_at'])
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('check_ins')
        .select('id, user_id, venue_id, city_slug, created_at')
        .eq('city_slug', currentCity.slug)
        .eq('date', today)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    const photos = photosRes.status === 'fulfilled' ? (photosRes.value.data || []) : [];
    const activity = activityRes.status === 'fulfilled' ? (activityRes.value.data || []) : [];
    const going = goingRes.status === 'fulfilled' ? (goingRes.value.data || []) : [];

    // Collect all user IDs
    const allUserIds = [...new Set([
      ...photos.map((r: { user_id: string }) => r.user_id),
      ...activity.map((r: { user_id: string }) => r.user_id),
      ...going.map((r: { user_id: string }) => r.user_id),
    ].filter(Boolean))];

    // Fetch profiles
    const pMap: Record<string, { display_name: string; avatar_url: string | null }> = {};
    if (allUserIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_emoji, avatar_url, username')
        .in('id', allUserIds);
      (profiles || []).forEach((p: { id: string; display_name: string; avatar_url: string | null }) => {
        pMap[p.id] = p;
      });
    }

    // Fetch venue names for going-tonight
    const venueIds = [...new Set(going.map((r: { venue_id: string }) => r.venue_id).filter(Boolean))];
    const vMap: Record<string, { name: string; neighborhood: string }> = {};
    if (venueIds.length) {
      const { data: venues } = await supabase
        .from('venues')
        .select('id, name, neighborhood')
        .in('id', venueIds);
      (venues || []).forEach((v: { id: string; name: string; neighborhood: string }) => {
        vMap[v.id] = v;
      });
    }

    // Normalize into unified feed
    const items: FeedPost[] = [
      ...photos.map((r: { id: string; user_id: string; venue_id: string; photo_url: string; caption: string | null; created_at: string }) => ({
        id: `photo-${r.id}`,
        type: 'photo',
        user_id: r.user_id,
        venue_id: r.venue_id,
        photo_url: r.photo_url,
        content: r.caption || null,
        venue_name: null as string | null,
        created_at: r.created_at,
        like_count: 0,
        comment_count: 0,
        display_name: pMap[r.user_id]?.display_name,
        avatar_url: pMap[r.user_id]?.avatar_url,
        isFollowing: followSet.has(r.user_id),
      })),
      ...activity.map((r: { id: string; user_id: string; activity_type: string; venue_id: string; venue_name: string | null; created_at: string }) => ({
        id: `activity-${r.id}`,
        type: r.activity_type,
        user_id: r.user_id,
        venue_id: r.venue_id,
        photo_url: null as string | null,
        content: null as string | null,
        venue_name: r.venue_name,
        created_at: r.created_at,
        like_count: 0,
        comment_count: 0,
        display_name: pMap[r.user_id]?.display_name,
        avatar_url: pMap[r.user_id]?.avatar_url,
        isFollowing: followSet.has(r.user_id),
      })),
      ...going.map((r: { id: string; user_id: string; venue_id: string; created_at: string }) => ({
        id: `going-${r.id}`,
        type: 'going_tonight',
        user_id: r.user_id,
        venue_id: r.venue_id,
        photo_url: null as string | null,
        content: null as string | null,
        venue_name: vMap[r.venue_id]?.name || null,
        created_at: r.created_at,
        like_count: 0,
        comment_count: 0,
        display_name: pMap[r.user_id]?.display_name,
        avatar_url: pMap[r.user_id]?.avatar_url,
        isFollowing: followSet.has(r.user_id),
      })),
    ];

    // Dedupe: if check_in + photo share same user+venue+day, keep only photo
    const photoKeys = new Set(
      items
        .filter((i) => i.type === 'photo')
        .map((i) => `${i.user_id}-${i.venue_id}-${i.created_at?.slice(0, 10)}`)
    );
    const deduped = items.filter((i) => {
      if (i.type !== 'check_in') return true;
      return !photoKeys.has(`${i.user_id}-${i.venue_id}-${i.created_at?.slice(0, 10)}`);
    });

    // Fetch like/comment counts for all post IDs
    const postIds = deduped.map((p) => p.id);
    if (postIds.length) {
      const [likesRes, commentsRes] = await Promise.allSettled([
        supabase.from('social_likes').select('post_id').in('post_id', postIds),
        supabase.from('social_comments').select('post_id').in('post_id', postIds),
      ]);
      const likeCounts: Record<string, number> = {};
      const commentCounts: Record<string, number> = {};
      if (likesRes.status === 'fulfilled') {
        (likesRes.value.data || []).forEach((r: { post_id: string }) => {
          likeCounts[r.post_id] = (likeCounts[r.post_id] || 0) + 1;
        });
      }
      if (commentsRes.status === 'fulfilled') {
        (commentsRes.value.data || []).forEach((r: { post_id: string }) => {
          commentCounts[r.post_id] = (commentCounts[r.post_id] || 0) + 1;
        });
      }
      deduped.forEach((p) => {
        p.like_count = likeCounts[p.id] || 0;
        p.comment_count = commentCounts[p.id] || 0;
      });
    }

    // Check which posts user has liked
    if (user && postIds.length) {
      const { data: likes } = await supabase
        .from('social_likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds);
      setLikedPosts(new Set((likes || []).map((l: { post_id: string }) => l.post_id)));
    }

    // Sort: following first, then by recency
    deduped.sort((a, b) => {
      if (a.isFollowing && !b.isFollowing) return -1;
      if (!a.isFollowing && b.isFollowing) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    setPosts(deduped.slice(0, 60));
    setLoading(false);
  }, [currentCity, user]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const toggleLike = async (postId: string) => {
    if (!user) {
      showToast({ text: 'Sign in to like posts', type: 'error' });
      return;
    }
    const isLiked = likedPosts.has(postId);
    if (isLiked) {
      await supabase.from('social_likes').delete().eq('user_id', user.id).eq('post_id', postId);
      setLikedPosts((prev) => { const n = new Set(prev); n.delete(postId); return n; });
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, like_count: Math.max(0, p.like_count - 1) } : p));
    } else {
      await supabase.from('social_likes').insert({ user_id: user.id, post_id: postId, post_type: 'social' });
      setLikedPosts((prev) => new Set(prev).add(postId));
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, like_count: p.like_count + 1 } : p));
    }
  };

  const openComments = async (postId: string) => {
    setCommentSheetPost(postId);
    setLoadingComments(true);
    const { data } = await supabase
      .from('social_comments')
      .select('id, user_id, post_id, post_type, text, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(50);
    const raw = (data || []) as Comment[];
    const uids = [...new Set(raw.map((c) => c.user_id))];
    if (uids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', uids);
      const pMap2 = new Map((profiles || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
      raw.forEach((c) => { c.display_name = pMap2.get(c.user_id) || 'User'; });
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
    setPosts((prev) => prev.map((p) => p.id === commentSheetPost ? { ...p, comment_count: p.comment_count + 1 } : p));
    openComments(commentSheetPost);
    showToast({ text: 'Comment posted!', type: 'success' });
  };

  const getPostEmoji = (type: string) => {
    switch (type) {
      case 'check_in': return '📍';
      case 'review': return '⭐';
      case 'photo': return '📸';
      case 'favorite': return '★';
      case 'going_tonight': return '🎯';
      case 'tagged_at': return '🏷';
      default: return '📡';
    }
  };

  const getPostText = (post: FeedPost) => {
    switch (post.type) {
      case 'photo': return post.content || `shared a photo${post.venue_name ? ` at ${post.venue_name}` : ''}`;
      case 'check_in': return `checked in${post.venue_name ? ` at ${post.venue_name}` : ''}`;
      case 'review': return `reviewed${post.venue_name ? ` ${post.venue_name}` : ''}`;
      case 'favorite': return `saved${post.venue_name ? ` ${post.venue_name}` : ''}`;
      case 'going_tonight': return `is going to${post.venue_name ? ` ${post.venue_name}` : ' a spot'} tonight`;
      case 'tagged_at': return `was tagged${post.venue_name ? ` at ${post.venue_name}` : ''}`;
      default: return post.content || post.type.replace('_', ' ');
    }
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  };

  return (
    <div className={styles.page}>
      <CityBar />

      <div className={styles.header}>
        <h1 className={styles.title}>Feed</h1>
      </div>

      <div className={styles.feed}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : posts.length === 0 ? (
          <div className={styles.empty}>
            <span>📡</span>
            <p>No activity yet — check in to a spot to get started!</p>
          </div>
        ) : (
          posts.map((post) => (
            <article key={post.id} className={styles.post}>
              <div className={styles.avatar}>
                {post.avatar_url ? (
                  <img src={post.avatar_url} alt="" />
                ) : (
                  <span className={styles.initials}>
                    {(post.display_name || 'U').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className={styles.body}>
                <div className={styles.postHeader}>
                  <span className={styles.name}>{post.display_name || 'Anonymous'}</span>
                  <span className={styles.time}>{timeAgo(post.created_at)}</span>
                </div>
                <p className={styles.text}>
                  {getPostEmoji(post.type)} {getPostText(post)}
                </p>
                {post.photo_url && (
                  <img
                    src={post.photo_url}
                    alt=""
                    className={styles.photo}
                    loading="lazy"
                    onClick={() => setLightboxSrc(post.photo_url)}
                    style={{ cursor: 'pointer' }}
                  />
                )}
                <div className={styles.postActions}>
                  <button
                    className={[styles.postAction, likedPosts.has(post.id) && styles.liked].filter(Boolean).join(' ')}
                    onClick={() => toggleLike(post.id)}
                  >
                    {likedPosts.has(post.id) ? '❤️' : '🤍'} {post.like_count || 0}
                  </button>
                  <button className={styles.postAction} onClick={() => openComments(post.id)}>
                    💬 {post.comment_count || 0}
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <Sheet open={!!commentSheetPost} onClose={() => { setCommentSheetPost(null); setComments([]); }}>
        <div className={styles.commentsSheet}>
          <span className={styles.commentsTitle}>Comments</span>
          {loadingComments ? (
            <div className="skeleton" style={{ height: 60, borderRadius: 12 }} />
          ) : comments.length === 0 ? (
            <p className={styles.noComments}>No comments yet</p>
          ) : (
            comments.map((c) => (
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
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                placeholder="Add a comment..."
              />
              <button className={styles.commentSend} onClick={submitComment}>↑</button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
