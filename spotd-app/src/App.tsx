import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { CityProvider } from './contexts/CityContext';
import { ToastContainer } from './components/ui/Toast';
import { BottomNav } from './components/layout/BottomNav';

const ExplorePage = lazy(() => import('./features/explore/ExplorePage'));
const MapPage = lazy(() => import('./features/map/MapPage'));
const SocialPage = lazy(() => import('./features/social/SocialPage'));
const DmsPage = lazy(() => import('./features/dms/DmsPage'));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const AuthPage = lazy(() => import('./features/auth/AuthPage'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CityProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<ExplorePage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/social" element={<SocialPage />} />
                <Route path="/dms" element={<DmsPage />} />
                <Route path="/dms/:threadId" element={<DmsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/:userId" element={<ProfilePage />} />
                <Route path="/auth" element={<AuthPage />} />
              </Routes>
            </Suspense>
            <BottomNav />
            <ToastContainer />
          </CityProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
