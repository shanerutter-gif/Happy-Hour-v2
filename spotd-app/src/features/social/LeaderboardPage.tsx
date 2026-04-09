import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCity } from '../../contexts/CityContext';
import { supabase } from '../../lib/supabase';
import styles from './LeaderboardPage.module.css';

interface LeaderEntry {
  user_id: string;
  count: number;
  venues: number;
  display_name?: string;
  avatar_url?: string;
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const { currentCity } = useCity();
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const monthName = new Date().toLocaleString('default', { month: 'long' });

  const load = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

    // Filter to current month's check-ins (matching vanilla)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const { data } = await supabase
      .from('check_ins')
      .select('user_id, venue_id')
      .eq('city_slug', currentCity.slug)
      .gte('created_at', monthStart);

    const countMap: Record<string, { count: number; venues: Set<string> }> = {};
    (data || []).forEach((row: { user_id: string; venue_id: string }) => {
      if (!countMap[row.user_id]) countMap[row.user_id] = { count: 0, venues: new Set() };
      countMap[row.user_id].count++;
      if (row.venue_id) countMap[row.user_id].venues.add(row.venue_id);
    });

    const sorted = Object.entries(countMap)
      .map(([user_id, u]) => ({ user_id, count: u.count, venues: u.venues.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    // Enrich with profiles
    const ids = sorted.map((e) => e.user_id);
    if (ids.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', ids);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string; avatar_url: string }) => [p.id, p]));
      sorted.forEach((e) => {
        const p = pMap.get(e.user_id);
        if (p) {
          (e as LeaderEntry).display_name = p.display_name;
          (e as LeaderEntry).avatar_url = p.avatar_url;
        }
      });
    }

    setEntries(sorted as LeaderEntry[]);
    setLoading(false);
  }, [currentCity]);

  useEffect(() => { load(); }, [load]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <div>
          <h1 className={styles.title}>Leaderboard</h1>
          <p className={styles.subtitle}>{monthName} · Most check-ins in {currentCity?.name || 'your city'}</p>
        </div>
      </div>

      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <span>🏆</span>
            <p>No check-ins yet — be the first!</p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.user_id}
              className={[styles.row, i < 3 && styles.topThree].filter(Boolean).join(' ')}
              onClick={() => navigate(`/profile/${entry.user_id}`)}
            >
              <span className={styles.rank}>
                {i < 3 ? medals[i] : `#${i + 1}`}
              </span>
              <div className={styles.avatar}>
                {entry.avatar_url ? (
                  <img src={entry.avatar_url} alt="" />
                ) : (
                  <span>{(entry.display_name || 'U').slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className={styles.info}>
                <span className={styles.name}>{entry.display_name || 'User'}</span>
                <span className={styles.meta}>{entry.venues} venue{entry.venues !== 1 ? 's' : ''}</span>
              </div>
              <span className={styles.count}>{entry.count} <span className={styles.countLabel}>check-ins</span></span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
