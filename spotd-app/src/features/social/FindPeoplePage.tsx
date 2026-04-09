import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBox } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import styles from './FindPeoplePage.module.css';

interface PersonResult {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  isFollowing: boolean;
}

export default function FindPeoplePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    setSearched(true);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, bio')
      .ilike('display_name', `%${q.trim()}%`)
      .limit(20);

    const raw = (profiles || []) as PersonResult[];

    // Check follow status
    if (user && raw.length) {
      const { data: follows } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id)
        .in('following_id', raw.map((p) => p.id));
      const followSet = new Set((follows || []).map((f: { following_id: string }) => f.following_id));
      raw.forEach((p) => { p.isFollowing = followSet.has(p.id); });
    }

    setResults(raw.filter((p) => p.id !== user?.id));
    setLoading(false);
  }, [user]);

  const toggleFollow = async (personId: string) => {
    if (!user) {
      showToast({ text: 'Sign in to follow people', type: 'error' });
      return;
    }
    const person = results.find((p) => p.id === personId);
    if (!person) return;

    if (person.isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', personId);
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: personId });
    }
    setResults((prev) => prev.map((p) =>
      p.id === personId ? { ...p, isFollowing: !p.isFollowing } : p
    ));
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <h1 className={styles.title}>Find People</h1>
      </div>

      <div className={styles.searchWrap}>
        <SearchBox
          placeholder="Search by name..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          onClear={() => { setQuery(''); setResults([]); setSearched(false); }}
        />
      </div>

      <div className={styles.results}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : results.length === 0 && searched ? (
          <div className={styles.empty}>
            <span>🔍</span>
            <p>No people found</p>
          </div>
        ) : (
          results.map((person) => (
            <div key={person.id} className={styles.personRow}>
              <div
                className={styles.personAvatar}
                onClick={() => navigate(`/profile/${person.id}`)}
              >
                {person.avatar_url ? (
                  <img src={person.avatar_url} alt="" />
                ) : (
                  <span>{(person.display_name || 'U').slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className={styles.personInfo} onClick={() => navigate(`/profile/${person.id}`)}>
                <span className={styles.personName}>{person.display_name}</span>
                {person.bio && <span className={styles.personBio}>{person.bio}</span>}
              </div>
              <Button
                size="sm"
                variant={person.isFollowing ? 'secondary' : 'primary'}
                onClick={() => toggleFollow(person.id)}
              >
                {person.isFollowing ? 'Following' : 'Follow'}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
