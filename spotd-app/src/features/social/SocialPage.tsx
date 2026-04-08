import { useState, useEffect, useCallback } from 'react';
import { CityBar } from '../../components/layout/CityBar';
import { Sheet } from '../../components/ui/Sheet';
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
  avatar_url?: string;
}

interface Comment {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  display_name?: string;
}

export default function SocialPage() {
  const { user } = useAuth();
  const { currentCity } = useCity();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  // Comments sheet state
  const [commentSheetPost, setCommentSheetPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

    let followingIds: string[] = [];
    if (user) {
      const { data: follows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);
      followingIds = (follows || []).map((f: { following_id: string }) => f.following_id);
    }

    const { data } = await supabase
      .from('social_posts')
      .select('*')
      .eq('city_slug', currentCity.slug)
      .order('created_at', { ascending: false })
      .limit(60);

    const raw = (data || []) as FeedPost[];
    const userIds = [...new Set(raw.map((p) => p.user_id))];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string; avatar_url: string }) => [p.id, p]));
      raw.forEach((p) => {
        const profile = pMap.get(p.user_id);
        if (profile) {
          p.display_name = profile.display_name;
          p.avatar_url = profile.avatar_url;
        }
      });
    }

    // Check which posts the user has liked
    if (user && raw.length) {
      const { data: likes } = await supabase
        .from('social_likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', raw.map((p) => p.id));
      setLikedPosts(new Set((likes || []).map((l: { post_id: string }) => l.post_id)));
    }

    const followSet = new Set(followingIds);
    raw.sort((a, b) => {
      const aFollow = followSet.has(a.user_id) ? 1 : 0;
      const bFollow = followSet.has(b.user_id) ? 1 : 0;
      if (aFollow !== bFollow) return bFollow - aFollow;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    setPosts(raw);
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
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    const raw = (data || []) as Comment[];
    // Enrich with names
    const uids = [...new Set(raw.map((c) => c.user_id))];
    if (uids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', uids);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
      raw.forEach((c) => { c.display_name = pMap.get(c.user_id) || 'User'; });
    }
    setComments(raw);
    setLoadingComments(false);
  };

  const submitComment = async () => {
    if (!user || !commentInput.trim() || !commentSheetPost) return;
    const body = commentInput.trim();
    setCommentInput('');
    await supabase.from('social_comments').insert({
      post_id: commentSheetPost,
      post_type: 'social',
      user_id: user.id,
      body,
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
      case 'fire': return '🔥';
      case 'going': return '🎯';
      case 'follow': return '👋';
      default: return '📡';
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
                  {getPostEmoji(post.type)}{' '}
                  {post.content || `${post.type.replace('_', ' ')} at ${post.venue_name || 'a venue'}`}
                </p>
                {post.photo_url && (
                  <img src={post.photo_url} alt="" className={styles.photo} loading="lazy" />
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

      {/* Comments sheet */}
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
                <p className={styles.commentBody}>{c.body}</p>
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
