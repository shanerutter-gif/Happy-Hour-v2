import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import styles from './NotificationsPage.module.css';

interface NotifItem {
  type: 'like' | 'comment';
  id: string;
  post_id: string;
  post_type: string;
  user_id: string;
  text?: string;
  created_at: string;
  profile: {
    id?: string;
    display_name?: string;
    avatar_emoji?: string;
    avatar_url?: string;
  };
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    // Mark as seen (same localStorage key as vanilla)
    localStorage.setItem('spotd-notif-seen', new Date().toISOString());

    // Get all post IDs owned by this user (activity_feed, checkin_photos, check_ins)
    const [af, cp, ci] = await Promise.all([
      supabase.from('activity_feed').select('id').eq('user_id', user.id),
      supabase.from('checkin_photos').select('id').eq('user_id', user.id),
      supabase.from('check_ins').select('id, venue_id').eq('user_id', user.id),
    ]);

    const myPostIds = new Set<string>();
    (af.data || []).forEach((r: { id: string }) => myPostIds.add('activity-' + r.id));
    (cp.data || []).forEach((r: { id: string }) => myPostIds.add('photo-' + r.id));
    (ci.data || []).forEach((r: { id: string }) => myPostIds.add('going-' + r.id));

    if (!myPostIds.size) { setItems([]); setLoading(false); return; }

    const postIdArr = [...myPostIds];

    // Fetch likes and comments on my posts (not by me)
    const [likesRes, commentsRes] = await Promise.all([
      supabase.from('social_likes')
        .select('id, post_id, post_type, user_id, created_at')
        .in('post_id', postIdArr)
        .neq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('social_comments')
        .select('id, post_id, post_type, user_id, text, created_at')
        .in('post_id', postIdArr)
        .neq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    // Fetch profiles
    const userIds = [
      ...new Set([
        ...(likesRes.data || []).map((l: { user_id: string }) => l.user_id),
        ...(commentsRes.data || []).map((c: { user_id: string }) => c.user_id),
      ]),
    ];
    const profiles: Record<string, { display_name?: string; avatar_emoji?: string; avatar_url?: string }> = {};
    if (userIds.length) {
      const { data: pdata } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_emoji, avatar_url')
        .in('id', userIds);
      (pdata || []).forEach((p: { id: string; display_name?: string; avatar_emoji?: string; avatar_url?: string }) => {
        profiles[p.id] = p;
      });
    }

    // Merge into unified list sorted by time
    const merged: NotifItem[] = [];
    (likesRes.data || []).forEach((l: { id: string; post_id: string; post_type: string; user_id: string; created_at: string }) =>
      merged.push({ type: 'like', ...l, profile: profiles[l.user_id] || {} })
    );
    (commentsRes.data || []).forEach((c: { id: string; post_id: string; post_type: string; user_id: string; text?: string; created_at: string }) =>
      merged.push({ type: 'comment', ...c, profile: profiles[c.user_id] || {} })
    );
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setItems(merged.slice(0, 50));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getInitials = (name?: string) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <h1 className={styles.title}>Activity</h1>
      </div>

      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : !user ? (
          <div className={styles.empty}>
            <span>🔔</span>
            <p>Sign in to see your notifications</p>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <span>🔔</span>
            <p>No notifications yet</p>
            <p className={styles.emptySub}>When people like or comment on your posts, you'll see it here</p>
          </div>
        ) : (
          items.map((n) => (
            <button
              key={`${n.type}-${n.id}`}
              className={styles.row}
              onClick={() => n.profile.id && navigate(`/profile/${n.profile.id}`)}
            >
              <div className={styles.avatar}>
                {n.profile.avatar_url ? (
                  <img src={n.profile.avatar_url} alt="" />
                ) : n.profile.avatar_emoji ? (
                  <span className={styles.avatarEmoji}>{n.profile.avatar_emoji}</span>
                ) : (
                  <span>{getInitials(n.profile.display_name)}</span>
                )}
              </div>
              <div className={styles.body}>
                <p className={styles.content}>
                  <strong>{n.profile.display_name || 'Someone'}</strong>
                  {n.type === 'like'
                    ? ' liked your post'
                    : ` commented: "${(n.text || '').slice(0, 60)}"`}
                </p>
                <span className={styles.time}>{timeAgo(n.created_at)}</span>
              </div>
              <span className={styles.icon}>{n.type === 'like' ? '❤️' : '💬'}</span>
            </button>
          ))
        )}
      </div>

      {items.length > 0 && (
        <div className={styles.backToFeed}>
          <button className={styles.backToFeedBtn} onClick={() => navigate('/social')}>
            Back to Feed
          </button>
        </div>
      )}
    </div>
  );
}
