import { useLocation, useNavigate } from 'react-router-dom';
import styles from './BottomNav.module.css';
import { useAuth } from '../../contexts/AuthContext';

function SpotsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}

function SpotrsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-1a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <line x1="10" y1="6" x2="18" y2="6" /><line x1="10" y1="10" x2="18" y2="10" /><line x1="10" y1="14" x2="14" y2="14" />
    </svg>
  );
}

const TABS = [
  { path: '/', icon: SpotsIcon, label: 'The Spots' },
  { path: '/social', icon: SpotrsIcon, label: 'The Spotrs' },
  { path: '/news', icon: NewsIcon, label: 'Your News' },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  // Build profile avatar initials
  const displayName = profile?.display_name || user?.user_metadata?.full_name || '';
  const initials = displayName
    ? displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <nav className={styles.nav} data-tt="nav">
      {TABS.map((tab) => {
        const isActive = tab.path === '/'
          ? pathname === '/' || pathname.startsWith('/explore')
          : pathname.startsWith(tab.path);
        const Icon = tab.icon;

        return (
          <button
            key={tab.path}
            className={[styles.tab, isActive && styles.active].filter(Boolean).join(' ')}
            onClick={() => navigate(tab.path)}
            aria-label={tab.label}
          >
            <span className={styles.icon}><Icon /></span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        );
      })}

      {/* Profile tab: shown only when logged in, uses avatar initials like vanilla app */}
      {user && (
        <button
          className={[styles.tab, (pathname === '/profile' || pathname.startsWith('/profile/')) && styles.active].filter(Boolean).join(' ')}
          onClick={() => navigate('/profile')}
          aria-label="Profile"
        >
          <span className={styles.avatar}>{initials}</span>
          <span className={styles.label}>Profile</span>
        </button>
      )}
    </nav>
  );
}
