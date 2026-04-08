import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { showToast } from '../../components/ui/Toast';
import type { Profile, Review, List } from '../../types/database';
import styles from './ProfilePage.module.css';

type Tab = 'activity' | 'reviews' | 'badges' | 'lists';

interface Badge { badge_key: string; earned_at: string; }
interface ActivityRow {
  id: string;
  type: string;
  venue_name: string | null;
  created_at: string;
}

const BADGE_META: Record<string, { emoji: string; label: string; desc: string }> = {
  first_checkin: { emoji: '📍', label: 'First Check-In', desc: 'Checked in for the first time' },
  regular: { emoji: '🏠', label: 'Regular', desc: '3+ check-ins at one venue' },
  explorer: { emoji: '🧭', label: 'Explorer', desc: 'Visited 5+ neighborhoods' },
  critic: { emoji: '📝', label: 'Critic', desc: 'Posted 10+ reviews' },
  top_reviewer: { emoji: '🌟', label: 'Top Reviewer', desc: 'Posted 25+ reviews' },
  social: { emoji: '👋', label: 'Social Butterfly', desc: '5+ followers' },
  streak_4: { emoji: '🔥', label: '4-Day Streak', desc: 'Checked in 4 days in a row' },
  streak_8: { emoji: '💎', label: '8-Day Streak', desc: 'Checked in 8 days in a row' },
};

export default function ProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user, profile: myProfile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('activity');
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [userReviews, setUserReviews] = useState<(Review & { venue_name?: string })[]>([]);
  const [userLists, setUserLists] = useState<List[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [neighborhoodFollows, setNeighborhoodFollows] = useState<string[]>([]);
  const [availableNeighborhoods, setAvailableNeighborhoods] = useState<string[]>([]);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  const isOwnProfile = !userId || userId === user?.id;
  const targetId = userId || user?.id;

  const loadProfile = useCallback(async () => {
    if (!targetId) { setLoading(false); return; }
    if (isOwnProfile && myProfile) {
      setProfile(myProfile);
      setLoading(false);
    } else {
      const { data } = await supabase.from('profiles').select('*').eq('id', targetId).single();
      setProfile(data as Profile | null);
      setLoading(false);
    }
  }, [targetId, isOwnProfile, myProfile]);

  const loadBadges = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase.from('user_badges').select('badge_key, earned_at').eq('user_id', targetId).order('earned_at', { ascending: false });
    setBadges((data || []) as Badge[]);
  }, [targetId]);

  const loadActivity = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('activity_feed')
      .select('id, activity_type, venue_name, created_at')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(20);
    setActivity((data || []).map((r: { id: string; activity_type: string; venue_name: string | null; created_at: string }) => ({
      id: r.id, type: r.activity_type, venue_name: r.venue_name, created_at: r.created_at,
    })));
  }, [targetId]);

  const loadReviews = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('reviews')
      .select('*')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(20);
    setUserReviews((data || []) as Review[]);
  }, [targetId]);

  const loadLists = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('lists')
      .select('*')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false });
    setUserLists((data || []) as List[]);
  }, [targetId]);

  const checkFollowing = useCallback(async () => {
    if (!user || !userId || userId === user.id) return;
    const { data } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', user.id)
      .eq('following_id', userId);
    setIsFollowing((data?.length || 0) > 0);
  }, [user, userId]);

  const loadNeighborhoodFollows = useCallback(async () => {
    if (!user || !isOwnProfile) return;
    const { data } = await supabase
      .from('neighborhood_follows')
      .select('neighborhood')
      .eq('user_id', user.id);
    setNeighborhoodFollows((data || []).map((r: { neighborhood: string }) => r.neighborhood));
    // Load available neighborhoods from venues
    const { data: venueData } = await supabase
      .from('venues')
      .select('neighborhood')
      .eq('city', profile?.city || '');
    const hoods = [...new Set((venueData || []).map((v: { neighborhood: string }) => v.neighborhood).filter(Boolean))].sort();
    setAvailableNeighborhoods(hoods as string[]);
  }, [user, isOwnProfile, profile?.city]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadBadges(); }, [loadBadges]);
  useEffect(() => { loadActivity(); }, [loadActivity]);
  useEffect(() => { loadReviews(); }, [loadReviews]);
  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { checkFollowing(); }, [checkFollowing]);
  useEffect(() => { loadNeighborhoodFollows(); }, [loadNeighborhoodFollows]);

  const toggleFollow = async () => {
    if (!user || !userId) return;
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', userId);
      setIsFollowing(false);
      showToast({ text: 'Unfollowed' });
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: userId });
      setIsFollowing(true);
      showToast({ text: 'Following!', type: 'success' });
    }
  };

  const createList = async () => {
    if (!user) return;
    const title = prompt('List name:');
    if (!title?.trim()) return;
    const { error } = await supabase.from('lists').insert({
      user_id: user.id, title: title.trim(), emoji: '📋', is_public: true,
    });
    if (error) showToast({ text: 'Failed to create list', type: 'error' });
    else { showToast({ text: 'List created!', type: 'success' }); loadLists(); }
  };

  const blockUser = async () => {
    if (!user || !userId) return;
    await supabase.from('blocked_users').insert({ blocker_id: user.id, blocked_id: userId });
    // Also unfollow
    await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', userId);
    setIsFollowing(false);
    setShowBlockConfirm(false);
    showToast({ text: 'User blocked' });
    navigate(-1);
  };

  const reportUser = async () => {
    if (!user || !userId) return;
    await supabase.from('reports').insert({
      reporter_id: user.id,
      content_type: 'user',
      content_id: userId,
      reason: 'Reported from profile',
    });
    showToast({ text: 'Report submitted — thanks!', type: 'success' });
  };

  const toggleNeighborhoodFollow = async (neighborhood: string) => {
    if (!user) return;
    if (neighborhoodFollows.includes(neighborhood)) {
      await supabase.from('neighborhood_follows')
        .delete()
        .eq('user_id', user.id)
        .eq('neighborhood', neighborhood);
      setNeighborhoodFollows((prev) => prev.filter((n) => n !== neighborhood));
      showToast({ text: `Unfollowed ${neighborhood}` });
    } else {
      await supabase.from('neighborhood_follows')
        .insert({ user_id: user.id, neighborhood, city_slug: profile?.city || '' });
      setNeighborhoodFollows((prev) => [...prev, neighborhood]);
      showToast({ text: `Following ${neighborhood}!`, type: 'success' });
    }
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  if (!user && isOwnProfile) {
    return (
      <div className={styles.page}>
        <div className={styles.authPrompt}>
          <h2>Join Spotd</h2>
          <p>Sign in to track your check-ins, follow friends, and save your favorites.</p>
          <Button onClick={() => navigate('/auth')} fullWidth>Sign In</Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={`skeleton ${styles.profileSkeleton}`} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.avatar}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span>{(profile?.display_name || 'U').slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <h2 className={styles.name}>{profile?.display_name || 'User'}</h2>
        {profile?.bio && <p className={styles.bio}>{profile.bio}</p>}

        {profile && profile.streak > 0 && (
          <div className={styles.streakBadge}>🔥 {profile.streak}-day streak</div>
        )}

        {/* Follow button for other profiles */}
        {!isOwnProfile && user && (
          <div className={styles.profileActions}>
            <Button
              variant={isFollowing ? 'secondary' : 'primary'}
              size="sm"
              onClick={toggleFollow}
              className={styles.followBtn}
            >
              {isFollowing ? 'Following' : 'Follow'}
            </Button>
            <button className={styles.moreBtn} onClick={() => setShowBlockConfirm(!showBlockConfirm)}>
              ···
            </button>
          </div>
        )}
        {showBlockConfirm && !isOwnProfile && (
          <div className={styles.blockMenu}>
            <button className={styles.blockMenuItem} onClick={reportUser}>
              🚩 Report User
            </button>
            <button className={[styles.blockMenuItem, styles.blockMenuDanger].join(' ')} onClick={blockUser}>
              🚫 Block User
            </button>
            <button className={styles.blockMenuItem} onClick={() => setShowBlockConfirm(false)}>
              Cancel
            </button>
          </div>
        )}

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statNum}>{profile?.check_in_count || 0}</span>
            <span className={styles.statLabel}>Check-ins</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{profile?.followers_count || 0}</span>
            <span className={styles.statLabel}>Followers</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{profile?.following_count || 0}</span>
            <span className={styles.statLabel}>Following</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{profile?.xp || 0}</span>
            <span className={styles.statLabel}>XP</span>
          </div>
        </div>
      </div>

      {isOwnProfile && (
        <div className={styles.quickActions}>
          <button className={styles.quickBtn} onClick={() => navigate('/find-people')}>
            🔍 Find People
          </button>
          <button className={styles.quickBtn} onClick={() => navigate('/leaderboard')}>
            🏆 Leaderboard
          </button>
        </div>
      )}

      <div className={styles.tabs}>
        {(['activity', 'reviews', 'badges', 'lists'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={[styles.tab, activeTab === tab && styles.tabActive].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {/* Activity tab */}
        {activeTab === 'activity' && (
          activity.length === 0 ? (
            <p className={styles.placeholder}>No activity yet</p>
          ) : (
            <div className={styles.activityList}>
              {activity.map((a) => (
                <div key={a.id} className={styles.activityRow}>
                  <span className={styles.activityEmoji}>
                    {a.type === 'check_in' ? '📍' : a.type === 'review' ? '⭐' : a.type === 'favorite' ? '★' : '📡'}
                  </span>
                  <div className={styles.activityBody}>
                    <span className={styles.activityText}>
                      {a.type.replace('_', ' ')}{a.venue_name ? ` at ${a.venue_name}` : ''}
                    </span>
                    <span className={styles.activityTime}>{timeAgo(a.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Reviews tab */}
        {activeTab === 'reviews' && (
          userReviews.length === 0 ? (
            <p className={styles.placeholder}>No reviews yet</p>
          ) : (
            <div className={styles.reviewList}>
              {userReviews.map((r) => (
                <div key={r.id} className={styles.reviewRow}>
                  <div className={styles.reviewRowHead}>
                    <span className={styles.reviewStars}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </span>
                    <span className={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.text && <p className={styles.reviewText}>{r.text}</p>}
                </div>
              ))}
            </div>
          )
        )}

        {/* Badges tab */}
        {activeTab === 'badges' && (
          badges.length === 0 ? (
            <p className={styles.placeholder}>No badges earned yet — start checking in!</p>
          ) : (
            <div className={styles.badgeGrid}>
              {badges.map((b) => {
                const meta = BADGE_META[b.badge_key];
                return (
                  <div key={b.badge_key} className={styles.badgeCard}>
                    <span className={styles.badgeEmoji}>{meta?.emoji || '🏅'}</span>
                    <span className={styles.badgeLabel}>{meta?.label || b.badge_key}</span>
                    <span className={styles.badgeDesc}>{meta?.desc || ''}</span>
                    <span className={styles.badgeDate}>{new Date(b.earned_at).toLocaleDateString()}</span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Lists tab */}
        {activeTab === 'lists' && (
          <>
            {isOwnProfile && (
              <button className={styles.createListBtn} onClick={createList}>+ Create List</button>
            )}
            {userLists.length === 0 ? (
              <p className={styles.placeholder}>No lists yet</p>
            ) : (
              <div className={styles.listGrid}>
                {userLists.map((l) => (
                  <div key={l.id} className={styles.listCard} onClick={() => navigate(`/lists/${l.id}`)}>
                    <span className={styles.listEmoji}>{l.emoji}</span>
                    <span className={styles.listTitle}>{l.title}</span>
                    <span className={styles.listCount}>{l.item_count} venues</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {isOwnProfile && availableNeighborhoods.length > 0 && (
        <div className={styles.neighborhoodSection}>
          <span className={styles.sectionLabel}>Neighborhood Follows</span>
          <p className={styles.sectionHint}>Get notified about new spots in these areas</p>
          <div className={styles.neighborhoodPills}>
            {availableNeighborhoods.map((n) => (
              <Pill
                key={n}
                active={neighborhoodFollows.includes(n)}
                onClick={() => toggleNeighborhoodFollow(n)}
              >
                {n}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {isOwnProfile && (
        <div className={styles.settings}>
          <button className={styles.settingsRow} onClick={toggle}>
            <span>🌙</span>
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
          <button
            className={styles.settingsRow}
            onClick={async () => { await signOut(); navigate('/'); }}
          >
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
