import { useState, useEffect, useCallback } from 'react';
import { CityBar } from '../../components/layout/CityBar';
import { useAuth } from '../../contexts/AuthContext';
import { useCity } from '../../contexts/CityContext';
import { supabase } from '../../lib/supabase';
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

export default function SocialPage() {
  const { user } = useAuth();
  const { currentCity } = useCity();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

    // Get following IDs
    let followingIds: string[] = [];
    if (user) {
      const { data: follows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);
      followingIds = (follows || []).map((f: { following_id: string }) => f.following_id);
    }

    // Fetch social feed
    const { data } = await supabase
      .from('social_posts')
      .select('*')
      .eq('city_slug', currentCity.slug)
      .order('created_at', { ascending: false })
      .limit(60);

    // Enrich with profiles
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

    // Sort: following first, then recency
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
                  <button className={styles.postAction}>❤️ {post.like_count || 0}</button>
                  <button className={styles.postAction}>💬 {post.comment_count || 0}</button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
