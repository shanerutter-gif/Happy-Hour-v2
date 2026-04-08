import { useLocation, useNavigate } from 'react-router-dom';
import styles from './BottomNav.module.css';
import { useAuth } from '../../contexts/AuthContext';

const TABS = [
  { path: '/', icon: '🔍', label: 'Explore' },
  { path: '/social', icon: '📡', label: 'Feed' },
  { path: '/dms', icon: '💬', label: 'DMs' },
  { path: '/notifications', icon: '🔔', label: 'Alerts' },
  { path: '/profile', icon: '👤', label: 'Profile' },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <nav className={styles.nav}>
      {TABS.map((tab) => {
        const isActive = tab.path === '/'
          ? pathname === '/' || pathname.startsWith('/explore')
          : pathname.startsWith(tab.path);

        // Hide DMs/Profile for non-authed users
        if (!user && (tab.path === '/dms' || tab.path === '/profile')) return null;

        return (
          <button
            key={tab.path}
            className={[styles.tab, isActive && styles.active].filter(Boolean).join(' ')}
            onClick={() => navigate(tab.path)}
            aria-label={tab.label}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
