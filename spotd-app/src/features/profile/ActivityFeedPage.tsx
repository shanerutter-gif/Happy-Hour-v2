import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import styles from './ActivityFeedPage.module.css';

interface ActivityRow {
  id: string;
  user_id: string;
  activity_type: string;
  venue_id: string | null;
  venue_name: string | null;
  neighborhood: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  profiles?: {
    display_name?: string;
    avatar_emoji?: string;
    avatar_url?: string;
  } | null;
}

type FeedTab = 'following' | 'mine';

const BADGE_LABELS: Record<string, string> = {
  first_checkin: 'First Check-in',
  regular: 'Regular',
  explorer: 'Explorer',
  critic: 'Critic',
  social: 'Social Butterfly',
  streak_4: '4-Week Streak',
  streak_8: '8-Week Streak',
  top_reviewer: 'Top Reviewer',
};

export default function ActivityFeedPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<FeedTab>('following');
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTab = useCallback(async (t: FeedTab) => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    if (t === 'following') {
      // Get who I follow
      const { data: follows } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id);
      const followingIds = (follows || []).map((f: { following_id: string }) => f.following_id);

      if (!followingIds.length) {
        setItems([]);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('activity_feed')
        .select('*')
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })
        .limit(30);

      const rows = (data || []) as ActivityRow[];

      // Fetch profiles
      const uids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
      if (uids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_emoji, avatar_url')
          .in('id', uids);
        const pMap: Record<string, ActivityRow['profiles']> = {};
        (profiles || []).forEach((p: { id: string; display_name?: string; avatar_emoji?: string; avatar_url?: string }) => {
          pMap[p.id] = p;
        });
        rows.forEach(r => { r.profiles = pMap[r.user_id] || null; });
      }

      setItems(rows);
    } else {
      const { data } = await supabase
        .from('activity_feed')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(40);

      const rows = (data || []) as ActivityRow[];
      rows.forEach(r => { r.profiles = { display_name: 'You' }; });
      setItems(rows);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const switchTab = (t: FeedTab) => {
    setTab(t);
  };

  const activityLabel = (a: ActivityRow) => {
    if (a.activity_type === 'check_in') return <>checked in at <strong>{a.venue_name || 'a spot'}</strong></>;
    if (a.activity_type === 'review') return <>reviewed <strong>{a.venue_name || 'a spot'}</strong></>;
    if (a.activity_type === 'favorite') return <>saved <strong>{a.venue_name || 'a spot'}</strong></>;
    if (a.activity_type === 'badge') {
      const key = (a.meta as Record<string, string>)?.badge_key || '';
      return <>earned {BADGE_LABELS[key] || 'a badge'}</>;
    }
    return <>was active</>;
  };

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
        <h1 className={styles.title}>Activity Feed</h1>
      </div>

      <div className={styles.tabs}>
        <button
          className={[styles.tabBtn, tab === 'following' && styles.tabActive].filter(Boolean).join(' ')}
          onClick={() => switchTab('following')}
        >Following</button>
        <button
          className={[styles.tabBtn, tab === 'mine' && styles.tabActive].filter(Boolean).join(' ')}
          onClick={() => switchTab('mine')}
        >My Activity</button>
      </div>

      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            {tab === 'following' ? (
              <>
                <span>👋</span>
                <p className={styles.emptyTitle}>No activity yet</p>
                <p className={styles.emptySub}>Follow people to see their check-ins & reviews here</p>
                <button className={styles.findBtn} onClick={() => navigate('/find-people')}>
                  🔍 Find People
                </button>
              </>
            ) : (
              <>
                <span>📋</span>
                <p>No activity yet</p>
              </>
            )}
          </div>
        ) : (
          items.map((a) => {
            const p = a.profiles || {};
            const isMe = a.user_id === user?.id;
            const name = isMe ? 'You' : (p.display_name || 'Someone');

            return (
              <div key={a.id} className={styles.row}>
                <div
                  className={styles.avatar}
                  onClick={() => !isMe && navigate(`/profile/${a.user_id}`)}
                  style={{ cursor: isMe ? 'default' : 'pointer' }}
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" />
                  ) : p.avatar_emoji ? (
                    <span className={styles.avatarEmoji}>{p.avatar_emoji}</span>
                  ) : (
                    <span>{getInitials(name)}</span>
                  )}
                </div>
                <div className={styles.body}>
                  <p className={styles.text}>
                    <span
                      className={styles.name}
                      onClick={() => !isMe && navigate(`/profile/${a.user_id}`)}
                      style={{ cursor: isMe ? 'default' : 'pointer' }}
                    >{name}</span>{' '}
                    {activityLabel(a)}
                  </p>
                  <p className={styles.meta}>
                    {a.neighborhood && <>📍 {a.neighborhood} · </>}
                    {timeAgo(a.created_at)}
                  </p>
                  {(a.meta as Record<string, string>)?.note && (
                    <p className={styles.note}>"{(a.meta as Record<string, string>).note}"</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
