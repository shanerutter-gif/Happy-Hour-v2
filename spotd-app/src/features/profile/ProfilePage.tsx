import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import type { Profile } from '../../types/database';
import styles from './ProfilePage.module.css';

type Tab = 'activity' | 'reviews' | 'badges' | 'lists';

interface Badge {
  badge_key: string;
  earned_at: string;
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

  const isOwnProfile = !userId || userId === user?.id;
  const targetId = userId || user?.id;

  const loadProfile = useCallback(async () => {
    if (!targetId) { setLoading(false); return; }
    if (isOwnProfile && myProfile) {
      setProfile(myProfile);
      setLoading(false);
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .single();
      setProfile(data as Profile | null);
      setLoading(false);
    }
  }, [targetId, isOwnProfile, myProfile]);

  const loadBadges = useCallback(async () => {
    if (!targetId) return;
    const { data } = await supabase
      .from('user_badges')
      .select('badge_key, earned_at')
      .eq('user_id', targetId)
      .order('earned_at', { ascending: false });
    setBadges((data || []) as Badge[]);
  }, [targetId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadBadges(); }, [loadBadges]);

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
      {/* Profile card */}
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

        {/* Streak badge */}
        {profile && profile.streak > 0 && (
          <div className={styles.streakBadge}>🔥 {profile.streak}-day streak</div>
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

      {/* Quick actions */}
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

      {/* Tabs */}
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

      {/* Tab content */}
      <div className={styles.tabContent}>
        {activeTab === 'badges' ? (
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
                    <span className={styles.badgeDate}>
                      {new Date(b.earned_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <p className={styles.placeholder}>
            {activeTab === 'activity' && 'Recent activity will appear here'}
            {activeTab === 'reviews' && 'Your reviews will appear here'}
            {activeTab === 'lists' && 'Your curated lists will appear here'}
          </p>
        )}
      </div>

      {/* Settings for own profile */}
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
