import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { CityProvider } from './contexts/CityContext';
import { ToastContainer } from './components/ui/Toast';
import { BottomNav } from './components/layout/BottomNav';
import { ExplorePage } from './features/explore/ExplorePage';
import { MapPage } from './features/map/MapPage';
import { SocialPage } from './features/social/SocialPage';
import { DmsPage } from './features/dms/DmsPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { AuthPage } from './features/auth/AuthPage';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CityProvider>
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
            <BottomNav />
            <ToastContainer />
          </CityProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
