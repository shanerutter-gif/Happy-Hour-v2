import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCity } from '../../contexts/CityContext';
import { supabase } from '../../lib/supabase';
import styles from './LeaderboardPage.module.css';

interface LeaderEntry {
  user_id: string;
  count: number;
  display_name?: string;
  avatar_url?: string;
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const { currentCity } = useCity();
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);

    // Get check-in counts grouped by user for this city
    const { data } = await supabase
      .from('check_ins')
      .select('user_id')
      .eq('city_slug', currentCity.slug);

    const countMap: Record<string, number> = {};
    (data || []).forEach((row: { user_id: string }) => {
      countMap[row.user_id] = (countMap[row.user_id] || 0) + 1;
    });

    const sorted = Object.entries(countMap)
      .map(([user_id, count]) => ({ user_id, count }))
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
        <h1 className={styles.title}>Leaderboard</h1>
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
              <span className={styles.name}>{entry.display_name || 'User'}</span>
              <span className={styles.count}>{entry.count} check-ins</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
