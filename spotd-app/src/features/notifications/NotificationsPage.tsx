import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import styles from './NotificationsPage.module.css';

interface NotifRow {
  id: string;
  type: string;
  content: string;
  read: boolean;
  created_at: string;
  actor_name?: string;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifs = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications((data || []) as NotifRow[]);
    setLoading(false);

    // Mark all as read
    if (data?.length) {
      const unread = data.filter((n: NotifRow) => !n.read).map((n: NotifRow) => n.id);
      if (unread.length) {
        supabase.from('notifications').update({ read: true }).in('id', unread).then(() => {});
      }
    }
  }, [user]);

  useEffect(() => { loadNotifs(); }, [loadNotifs]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'follow': return '👋';
      case 'like': return '❤️';
      case 'comment': return '💬';
      case 'check_in': return '📍';
      case 'fire': return '🔥';
      default: return '🔔';
    }
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
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
        ) : notifications.length === 0 ? (
          <div className={styles.empty}>
            <span>🔔</span>
            <p>No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={[styles.row, !n.read && styles.unread].filter(Boolean).join(' ')}
            >
              <span className={styles.icon}>{getIcon(n.type)}</span>
              <div className={styles.body}>
                <p className={styles.content}>{n.content}</p>
                <span className={styles.time}>{timeAgo(n.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
