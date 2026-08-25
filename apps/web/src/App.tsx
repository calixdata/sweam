import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/Status';
import { Discover } from './pages/Discover';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { Admin } from './pages/Admin';
import { AdminModeration } from './pages/AdminModeration';
import { AdminMonetization } from './pages/AdminMonetization';
import { Browse } from './pages/Browse';
import { CreatorPage } from './pages/CreatorPage';
import { Notifications } from './pages/Notifications';
import { Scout } from './pages/Scout';
import { ScoutOneSheet } from './pages/ScoutOneSheet';
import { Search } from './pages/Search';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Studio } from './pages/Studio';
import { StudioAnalytics } from './pages/StudioAnalytics';
import { StudioEarnings } from './pages/StudioEarnings';
import { StudioTitle } from './pages/StudioTitle';
import { TitlePage } from './pages/TitlePage';
import { Watch } from './pages/Watch';
import { Watchlist } from './pages/Watchlist';

/** Redirects signed-out visitors to sign-in, remembering where they were headed. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/search" element={<Search />} />
        <Route path="/t/:slug" element={<TitlePage />} />
        <Route path="/c/:handle" element={<CreatorPage />} />
        <Route path="/watch/:episodeId" element={<Watch />} />
        <Route
          path="/watchlist"
          element={
            <RequireAuth>
              <Watchlist />
            </RequireAuth>
          }
        />
        <Route path="/studio" element={<Studio />} />
        <Route
          path="/studio/earnings"
          element={
            <RequireAuth>
              <StudioEarnings />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/t/:titleId"
          element={
            <RequireAuth>
              <StudioTitle />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/t/:titleId/analytics"
          element={
            <RequireAuth>
              <StudioAnalytics />
            </RequireAuth>
          }
        />
        <Route path="/scout" element={<Scout />} />
        <Route
          path="/scout/t/:titleId"
          element={
            <RequireAuth>
              <ScoutOneSheet />
            </RequireAuth>
          }
        />
        <Route
          path="/notifications"
          element={
            <RequireAuth>
              <Notifications />
            </RequireAuth>
          }
        />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/moderation" element={<AdminModeration />} />
        <Route path="/admin/monetization" element={<AdminMonetization />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
