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

type Tab = 'checkins' | 'reviews' | 'saved' | 'lists';

interface CheckInRow {
  id: string;
  venue_id: string;
  venue_name: string | null;
  neighborhood: string | null;
  created_at: string;
  date: string;
}

interface FavItem {
  item_id: string;
  item_type: string;
}

export default function ProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user, profile: myProfile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('checkins');
  const [loading, setLoading] = useState(true);
  const [checkIns, setCheckIns] = useState<CheckInRow[]>([]);
  const [userReviews, setUserReviews] = useState<(Review & { venue_name?: string })[]>([]);
  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [userLists, setUserLists] = useState<List[]>([]);
  const [followingCount, setFollowingCount] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [neighborhoodFollows, setNeighborhoodFollows] = useState<string[]>([]);
  const [availableNeighborhoods, setAvailableNeighborhoods] = useState<string[]>([]);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [showIdeaBanner, setShowIdeaBanner] = useState(() => !localStorage.getItem('ideaBannerDismissed'));

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

  const loadCheckIns = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('check_ins')
      .select('id, venue_id, venue_name, neighborhood, created_at, date')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(30);
    setCheckIns((data || []) as CheckInRow[]);
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

  const loadFavorites = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('favorites')
      .select('item_id, item_type')
      .eq('user_id', targetId);
    setFavorites((data || []) as FavItem[]);
  }, [targetId]);

  const loadLists = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('user_lists')
      .select('*')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false });
    setUserLists((data || []) as List[]);
  }, [targetId]);

  const loadFollowCounts = useCallback(async () => {
    if (!targetId) return;
    const [{ count: fing }, { count: fers }] = await Promise.all([
      supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetId),
      supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', targetId),
    ]);
    setFollowingCount(fing || 0);
    setFollowersCount(fers || 0);
  }, [targetId]);

  const checkFollowing = useCallback(async () => {
    if (!user || !userId || userId === user.id) return;
    const { data } = await supabase
      .from('user_follows')
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
    const { data: venueData } = await supabase
      .from('venues')
      .select('neighborhood')
      .eq('city_slug', 'san-diego');
    const hoods = [...new Set((venueData || []).map((v: { neighborhood: string }) => v.neighborhood).filter(Boolean))].sort();
    setAvailableNeighborhoods(hoods as string[]);
  }, [user, isOwnProfile]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadCheckIns(); }, [loadCheckIns]);
  useEffect(() => { loadReviews(); }, [loadReviews]);
  useEffect(() => { loadFavorites(); }, [loadFavorites]);
  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { loadFollowCounts(); }, [loadFollowCounts]);
  useEffect(() => { checkFollowing(); }, [checkFollowing]);
  useEffect(() => { loadNeighborhoodFollows(); }, [loadNeighborhoodFollows]);

  const toggleFollow = async () => {
    if (!user || !userId) return;
    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', userId);
      setIsFollowing(false);
      showToast({ text: 'Unfollowed' });
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: userId });
      setIsFollowing(true);
      showToast({ text: 'Following!', type: 'success' });
    }
    loadFollowCounts();
  };

  const createList = async () => {
    if (!user) return;
    const title = prompt('List name:');
    if (!title?.trim()) return;
    const { error } = await supabase.from('user_lists').insert({
      user_id: user.id, title: title.trim(), cover_emoji: '📋', is_public: true,
    });
    if (error) showToast({ text: 'Failed to create list', type: 'error' });
    else { showToast({ text: 'List created!', type: 'success' }); loadLists(); }
  };

  const blockUser = async () => {
    if (!user || !userId) return;
    await supabase.from('blocked_users').insert({ blocker_id: user.id, blocked_id: userId });
    await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', userId);
    setIsFollowing(false);
    setShowBlockConfirm(false);
    showToast({ text: 'User blocked' });
    navigate(-1);
  };

  const reportUser = async () => {
    if (!user || !userId) return;
    await supabase.from('reports').insert({
      reporter_id: user.id, content_type: 'user', content_id: userId, reason: 'Reported from profile',
    });
    showToast({ text: 'Report submitted — thanks!', type: 'success' });
  };

  const toggleNeighborhoodFollow = async (neighborhood: string) => {
    if (!user) return;
    if (neighborhoodFollows.includes(neighborhood)) {
      await supabase.from('neighborhood_follows').delete().eq('user_id', user.id).eq('neighborhood', neighborhood);
      setNeighborhoodFollows(prev => prev.filter(n => n !== neighborhood));
      showToast({ text: `Unfollowed ${neighborhood}` });
    } else {
      await supabase.from('neighborhood_follows').insert({ user_id: user.id, neighborhood });
      setNeighborhoodFollows(prev => [...prev, neighborhood]);
      showToast({ text: `Following ${neighborhood}!`, type: 'success' });
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const updates: Record<string, string> = {};
    if (editName.trim()) updates.display_name = editName.trim();
    updates.bio = editBio.trim();
    await supabase.from('profiles').update(updates).eq('id', user.id);
    setSavingProfile(false);
    setShowEditProfile(false);
    showToast({ text: 'Profile updated!', type: 'success' });
    loadProfile();
  };

  const openEditProfile = () => {
    setEditName(profile?.display_name || '');
    setEditBio(profile?.bio || '');
    setShowEditProfile(true);
  };

  // Badge definitions matching vanilla app
  const BADGE_DEFS: { key: string; icon: string; label: string; check: () => boolean }[] = [
    { key: 'first_checkin', icon: '📍', label: 'First Check-in', check: () => checkIns.length >= 1 },
    { key: 'regular', icon: '🏅', label: 'Regular', check: () => {
      const venueCounts = new Map<string, number>();
      checkIns.forEach(c => venueCounts.set(c.venue_id, (venueCounts.get(c.venue_id) || 0) + 1));
      return [...venueCounts.values()].some(c => c >= 3);
    }},
    { key: 'explorer', icon: '🧭', label: 'Neighborhood Explorer', check: () => {
      const hoods = new Set(checkIns.map(c => c.neighborhood).filter(Boolean));
      return hoods.size >= 5;
    }},
    { key: 'critic', icon: '⭐', label: 'Critic', check: () => userReviews.length >= 10 },
    { key: 'social', icon: '🤝', label: 'Social Butterfly', check: () => followersCount >= 5 },
    { key: 'streak_4', icon: '🔥', label: '4-Week Streak', check: () => (profile?.streak || 0) >= 28 },
    { key: 'streak_8', icon: '🔥', label: '8-Week Streak', check: () => (profile?.streak || 0) >= 56 },
    { key: 'top_reviewer', icon: '✏️', label: 'Top Reviewer', check: () => userReviews.length >= 25 },
  ];
  const earnedBadges = BADGE_DEFS.filter(b => b.check());

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
        <div className={styles.skeletonCard}>
          <div className={`skeleton ${styles.skeletonAvatar}`} />
          <div className={`skeleton ${styles.skeletonName}`} />
          <div className={styles.skeletonStats}>
            <div className={`skeleton ${styles.skeletonStat}`} />
            <div className={`skeleton ${styles.skeletonStat}`} />
            <div className={`skeleton ${styles.skeletonStat}`} />
            <div className={`skeleton ${styles.skeletonStat}`} />
          </div>
        </div>
        <div className={styles.skeletonTabs}>
          <div className={`skeleton ${styles.skeletonTab}`} />
          <div className={`skeleton ${styles.skeletonTab}`} />
          <div className={`skeleton ${styles.skeletonTab}`} />
          <div className={`skeleton ${styles.skeletonTab}`} />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`skeleton ${styles.skeletonRow}`} />
        ))}
      </div>
    );
  }

  const displayName = profile?.display_name || 'User';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className={styles.page}>
      {/* Header: logo + action buttons (matches vanilla pf-header) */}
      <div className={styles.pfHeader}>
        <img src="/spotd_logo_v5.png" alt="Spotd" className={styles.headerLogo} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        {isOwnProfile && (
          <div className={styles.pfHeaderActions}>
            <button className={styles.pfHeaderBtn} onClick={() => navigate('/dms')} title="Messages">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            <div className={styles.pfMenuAnchor}>
              <button className={styles.pfHeaderBtn} onClick={() => setShowMenu(!showMenu)} title="Menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
              </button>
              {showMenu && (
                <div className={styles.pfDropdown}>
                  <button className={styles.pfDropdownItem} onClick={() => { toggle(); setShowMenu(false); }}>
                    {theme === 'dark' ? '☀️' : '🌙'} <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                  </button>
                  <button className={styles.pfDropdownItem} onClick={async () => {
                    setShowMenu(false);
                    if (navigator.share) {
                      await navigator.share({ title: 'Spotd', text: 'Find the best happy hours near you!', url: window.location.origin }).catch(() => {});
                    } else {
                      await navigator.clipboard.writeText(window.location.origin);
                      showToast({ text: 'Link copied!', type: 'success' });
                    }
                  }}>
                    📤 <span>Share Spotd</span>
                  </button>
                  <div className={styles.pfDropdownSep} />
                  <button className={styles.pfDropdownItem} onClick={() => { setShowMenu(false); openEditProfile(); }}>
                    ✏️ <span>Edit Profile</span>
                  </button>
                  <button className={styles.pfDropdownItem} onClick={() => { navigate('/find-people'); setShowMenu(false); }}>
                    🔍 <span>Find People</span>
                  </button>
                  <button className={styles.pfDropdownItem} onClick={() => { navigate('/leaderboard'); setShowMenu(false); }}>
                    🏆 <span>Leaderboard</span>
                  </button>
                  <div className={styles.pfDropdownSep} />
                  <button className={styles.pfDropdownItem} onClick={async () => { await signOut(); navigate('/'); setShowMenu(false); }}>
                    🚪 <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Profile card with banner */}
      <div className={styles.card}>
        {profile?.header_url ? (
          <div className={styles.banner}>
            <img src={profile.header_url} alt="" className={styles.bannerImg} />
          </div>
        ) : (
          <div className={styles.bannerFallback} />
        )}
        <div className={styles.avatar}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        <h2 className={styles.name}>{displayName}</h2>
        {profile?.bio ? (
          <p className={styles.bio}>{profile.bio}</p>
        ) : isOwnProfile ? (
          <p className={styles.bioEmpty}>+ add a bio</p>
        ) : null}

        {profile?.streak && profile.streak > 0 ? (
          <span className={styles.streakBadge}>🔥 {profile.streak} day streak</span>
        ) : null}

        {/* Earned badges */}
        {earnedBadges.length > 0 && (
          <div className={styles.badgeRow}>
            {earnedBadges.map(b => (
              <span key={b.key} className={styles.badge} title={b.label}>{b.icon}</span>
            ))}
          </div>
        )}

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
            <button className={styles.moreBtn} onClick={() => setShowBlockConfirm(!showBlockConfirm)}>···</button>
          </div>
        )}
        {showBlockConfirm && !isOwnProfile && (
          <div className={styles.blockMenu}>
            <button className={styles.blockMenuItem} onClick={reportUser}>🚩 Report User</button>
            <button className={[styles.blockMenuItem, styles.blockMenuDanger].join(' ')} onClick={blockUser}>🚫 Block User</button>
            <button className={styles.blockMenuItem} onClick={() => setShowBlockConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>

      {/* Stats: Check-ins / Reviews / Following / Followers */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{checkIns.length}</span>
          <span className={styles.statLabel}>Check-ins</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{userReviews.length}</span>
          <span className={styles.statLabel}>Reviews</span>
        </div>
        <div className={styles.stat} onClick={() => navigate('/find-people')}>
          <span className={styles.statNum}>{followingCount}</span>
          <span className={styles.statLabel}>Following</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{followersCount}</span>
          <span className={styles.statLabel}>Followers</span>
        </div>
      </div>

      {/* Idea banner */}
      {isOwnProfile && showIdeaBanner && (
        <div className={styles.ideaBanner}>
          <span className={styles.ideaIcon}>💡</span>
          <span className={styles.ideaText}>Have an idea for a feature? Let us know!</span>
          <button className={styles.ideaDismiss} onClick={() => { setShowIdeaBanner(false); localStorage.setItem('ideaBannerDismissed', '1'); }}>×</button>
        </div>
      )}

      {/* Tabs: Check-ins / Reviews / Saved / Lists */}
      <div className={styles.tabs}>
        {(['checkins', 'reviews', 'saved', 'lists'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={[styles.tab, activeTab === tab && styles.tabActive].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'checkins' ? 'Check-ins' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {/* Check-ins tab */}
        {activeTab === 'checkins' && (
          checkIns.length === 0 ? (
            <div className={styles.emptyState}><span>📍</span>No check-ins yet — go explore!</div>
          ) : (
            <div className={styles.activityList}>
              {checkIns.map(c => (
                <div key={c.id} className={styles.activityRow}>
                  <div className={styles.activityIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  </div>
                  <div className={styles.activityBody}>
                    <span className={styles.activityText}>{c.venue_name || 'A spot'}</span>
                    <span className={styles.activityTime}>{c.neighborhood || ''} · {timeAgo(c.created_at || c.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Reviews tab */}
        {activeTab === 'reviews' && (
          userReviews.length === 0 ? (
            <div className={styles.emptyState}><span>⭐</span>No reviews yet</div>
          ) : (
            <div className={styles.reviewList}>
              {userReviews.map(r => (
                <div key={r.id} className={styles.reviewRow}>
                  <div className={styles.reviewRowHead}>
                    <span className={styles.reviewStars}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    <span className={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.text && <p className={styles.reviewText}>{r.text}</p>}
                </div>
              ))}
            </div>
          )
        )}

        {/* Saved tab (favorites) */}
        {activeTab === 'saved' && (
          favorites.length === 0 ? (
            <div className={styles.emptyState}><span>🔖</span>No saved spots yet — tap ★ on any venue</div>
          ) : (
            <div className={styles.activityList}>
              {favorites.map(f => (
                <div key={f.item_id} className={styles.activityRow}>
                  <div className={styles.activityIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <div className={styles.activityBody}>
                    <span className={styles.activityText}>Saved venue</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Lists tab */}
        {activeTab === 'lists' && (
          <>
            {isOwnProfile && (
              <button className={styles.createListBtn} onClick={createList}>+ New List</button>
            )}
            {userLists.length === 0 ? (
              <div className={styles.emptyState}><span>📋</span>No lists yet</div>
            ) : (
              <div className={styles.listGrid}>
                {userLists.map(l => (
                  <div key={l.id} className={styles.listCard} onClick={() => navigate(`/lists/${l.id}`)}>
                    <span className={styles.listEmoji}>{l.cover_emoji || '📋'}</span>
                    <span className={styles.listTitle}>{l.title}</span>
                    <span className={styles.listCount}>{l.item_count || 0} venues</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Neighborhood follows */}
      {isOwnProfile && availableNeighborhoods.length > 0 && (
        <div className={styles.neighborhoodSection}>
          <span className={styles.sectionLabel}>Neighborhood Follows</span>
          <p className={styles.sectionHint}>Get notified about new spots in these areas</p>
          <div className={styles.neighborhoodPills}>
            {availableNeighborhoods.map(n => (
              <Pill key={n} active={neighborhoodFollows.includes(n)} onClick={() => toggleNeighborhoodFollow(n)}>
                {n}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Edit profile overlay */}
      {showEditProfile && (
        <div className={styles.editOverlay}>
          <div className={styles.editSheet}>
            <div className={styles.editHeader}>
              <h3>Edit Profile</h3>
              <button className={styles.editClose} onClick={() => setShowEditProfile(false)}>×</button>
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Display Name</label>
              <input
                className={styles.editInput}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Bio</label>
              <textarea
                className={styles.editTextarea}
                value={editBio}
                onChange={e => setEditBio(e.target.value)}
                placeholder="Tell people about yourself..."
                rows={3}
              />
            </div>
            <Button fullWidth onClick={saveProfile} loading={savingProfile}>Save Changes</Button>
          </div>
        </div>
      )}
    </div>
  );
}
