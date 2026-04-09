import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import styles from './FindPeoplePage.module.css';

interface FollowerProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_emoji?: string | null;
  username?: string | null;
}

export default function FollowersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userId } = useParams<{ userId?: string }>();
  const targetId = userId || user?.id;
  const [followers, setFollowers] = useState<FollowerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!targetId) { setLoading(false); return; }
    (async () => {
      const { data: follows } = await supabase
        .from('user_follows')
        .select('follower_id')
        .eq('following_id', targetId);
      const ids = (follows || []).map((f: { follower_id: string }) => f.follower_id);
      if (!ids.length) { setFollowers([]); setLoading(false); return; }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, avatar_emoji, username')
        .in('id', ids);
      setFollowers((profiles || []) as FollowerProfile[]);
      setLoading(false);
    })();
  }, [targetId]);

  const getInitials = (name?: string) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <h1 className={styles.title}>Followers</h1>
      </div>

      <div className={styles.results}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : followers.length === 0 ? (
          <div className={styles.empty}>
            <p>No followers yet</p>
          </div>
        ) : (
          followers.map((p) => (
            <div key={p.id} className={styles.personRow}>
              <div
                className={styles.personAvatar}
                onClick={() => navigate(`/profile/${p.id}`)}
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" />
                ) : p.avatar_emoji ? (
                  <span className={styles.avatarEmoji}>{p.avatar_emoji}</span>
                ) : (
                  <span>{getInitials(p.display_name)}</span>
                )}
              </div>
              <div className={styles.personInfo} onClick={() => navigate(`/profile/${p.id}`)}>
                <span className={styles.personName}>{p.display_name || 'Spotd User'}</span>
                {p.username && <span className={styles.personBio}>@{p.username}</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 18 }}>›</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
