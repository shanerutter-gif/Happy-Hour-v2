import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { CityProvider } from './contexts/CityContext';
import { ToastContainer } from './components/ui/Toast';
import { BottomNav } from './components/layout/BottomNav';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AgeGate, needsAgeGate } from './features/onboarding/AgeGate';

const ExplorePage = lazy(() => import('./features/explore/ExplorePage'));
const MapPage = lazy(() => import('./features/map/MapPage'));
const SocialPage = lazy(() => import('./features/social/SocialPage'));
const DmsPage = lazy(() => import('./features/dms/DmsPage'));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage'));
const NewsPage = lazy(() => import('./features/news/NewsPage'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const AuthPage = lazy(() => import('./features/auth/AuthPage'));
const FindPeoplePage = lazy(() => import('./features/social/FindPeoplePage'));
const LeaderboardPage = lazy(() => import('./features/social/LeaderboardPage'));
const ListDetailPage = lazy(() => import('./features/lists/ListDetailPage'));
const LegalPage = lazy(() => import('./features/legal/LegalPage'));
const ActivityFeedPage = lazy(() => import('./features/profile/ActivityFeedPage'));
const FollowersPage = lazy(() => import('./features/social/FollowersPage'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
    </div>
  );
}

export default function App() {
  const [showAgeGate, setShowAgeGate] = useState(needsAgeGate);

  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CityProvider>
            <ErrorBoundary>
              {showAgeGate && <AgeGate onVerified={() => setShowAgeGate(false)} />}
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<ExplorePage />} />
                  <Route path="/map" element={<MapPage />} />
                  <Route path="/social" element={<SocialPage />} />
                  <Route path="/dms" element={<DmsPage />} />
                  <Route path="/dms/:threadId" element={<DmsPage />} />
                  <Route path="/news" element={<NewsPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/profile/:userId" element={<ProfilePage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/find-people" element={<FindPeoplePage />} />
                  <Route path="/leaderboard" element={<LeaderboardPage />} />
                  <Route path="/lists/:listId" element={<ListDetailPage />} />
                  <Route path="/activity" element={<ActivityFeedPage />} />
                  <Route path="/followers" element={<FollowersPage />} />
                  <Route path="/followers/:userId" element={<FollowersPage />} />
                  <Route path="/legal/:page" element={<LegalPage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
            <BottomNav />
            <ToastContainer />
          </CityProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
