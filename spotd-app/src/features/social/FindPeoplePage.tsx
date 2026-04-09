import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBox } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import { haptic } from '../../lib/haptic';
import styles from './FindPeoplePage.module.css';

interface PersonResult {
  id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_emoji?: string | null;
  bio: string | null;
  isFollowing: boolean;
}

export default function FindPeoplePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [followingList, setFollowingList] = useState<PersonResult[]>([]);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(true);

  // Load current following list on mount (matches vanilla openFindPeople default state)
  useEffect(() => {
    if (!user) { setLoadingFollowing(false); return; }
    (async () => {
      const { data: follows } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id);
      const ids = (follows || []).map((f: { following_id: string }) => f.following_id);
      const fSet = new Set(ids);
      setFollowingSet(fSet);

      if (ids.length) {
        const { data } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url, avatar_emoji, bio')
          .in('id', ids);
        setFollowingList(
          (data || []).map((p: PersonResult) => ({ ...p, isFollowing: true }))
        );
      }
      setLoadingFollowing(false);
    })();
  }, [user]);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, avatar_emoji, bio')
      .ilike('display_name', `%${q.trim()}%`)
      .limit(20);

    const raw = (profiles || []) as PersonResult[];
    raw.forEach((p) => { p.isFollowing = followingSet.has(p.id); });

    setResults(raw.filter((p) => p.id !== user?.id));
    setLoading(false);
  }, [user, followingSet]);

  const toggleFollow = async (personId: string) => {
    haptic('light');
    if (!user) {
      showToast({ text: 'Sign in to follow people', type: 'error' });
      return;
    }

    const isFollowing = followingSet.has(personId);

    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', personId);
      followingSet.delete(personId);
      showToast({ text: 'Unfollowed' });
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: personId });
      followingSet.add(personId);
      showToast({ text: 'Following!' });
    }
    setFollowingSet(new Set(followingSet));

    // Update both lists
    setResults((prev) => prev.map((p) =>
      p.id === personId ? { ...p, isFollowing: !isFollowing } : p
    ));
    setFollowingList((prev) => {
      if (isFollowing) return prev.filter(p => p.id !== personId);
      const person = results.find(p => p.id === personId);
      if (person) return [...prev, { ...person, isFollowing: true }];
      return prev;
    });
  };

  const renderPerson = (person: PersonResult) => (
    <div key={person.id} className={styles.personRow}>
      <div
        className={styles.personAvatar}
        onClick={() => navigate(`/profile/${person.id}`)}
      >
        {person.avatar_url ? (
          <img src={person.avatar_url} alt="" />
        ) : person.avatar_emoji ? (
          <span className={styles.avatarEmoji}>{person.avatar_emoji}</span>
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
        {person.isFollowing ? '✓ Following' : '+ Follow'}
      </Button>
    </div>
  );

  // Show search results if searching, otherwise show following list
  const showSearchResults = query.trim().length >= 2;

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
        {showSearchResults ? (
          // Search results
          loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`skeleton ${styles.skeleton}`} />
            ))
          ) : results.length === 0 && searched ? (
            <div className={styles.empty}>
              <span>🔍</span>
              <p>No one found for "{query}"</p>
            </div>
          ) : (
            results.map(renderPerson)
          )
        ) : (
          // Default: show following list
          loadingFollowing ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`skeleton ${styles.skeleton}`} />
            ))
          ) : followingList.length === 0 ? (
            <div className={styles.empty}>
              <p>Search above to find friends</p>
            </div>
          ) : (
            <>
              <div className={styles.sectionLabel}>Following ({followingList.length})</div>
              {followingList.map(renderPerson)}
            </>
          )
        )}
      </div>
    </div>
  );
}
