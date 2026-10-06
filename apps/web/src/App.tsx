import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/Status';
import { Discover } from './pages/Discover';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { Admin } from './pages/Admin';
import { AdminAccounts } from './pages/AdminAccounts';
import { AdminScouts } from './pages/AdminScouts';
import { AdminModeration } from './pages/AdminModeration';
import { AdminMonetization } from './pages/AdminMonetization';
import { AdminSubmissions } from './pages/AdminSubmissions';
import { AdminVideo } from './pages/AdminVideo';
import { Browse } from './pages/Browse';
import { ConfirmEmailChange } from './pages/ConfirmEmailChange';
import { Contact } from './pages/Contact';
import { CreatorPage } from './pages/CreatorPage';
import { Faq } from './pages/Faq';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { AiDisclosure } from './pages/legal/AiDisclosure';
import { CommunityGuidelines } from './pages/legal/CommunityGuidelines';
import { Cookies } from './pages/legal/Cookies';
import { DeleteAccount } from './pages/legal/DeleteAccount';
import { CreatorAgreement } from './pages/legal/CreatorAgreement';
import { ScoutTerms } from './pages/legal/ScoutTerms';
import { Privacy } from './pages/legal/Privacy';
import { Terms } from './pages/legal/Terms';
import { MeSubscriptions } from './pages/MeSubscriptions';
import { Notifications } from './pages/Notifications';
import { Record } from './pages/Record';
import { Scout } from './pages/Scout';
import { Settings } from './pages/Settings';
import { ScoutOneSheet } from './pages/ScoutOneSheet';
import { Search } from './pages/Search';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Verify } from './pages/Verify';
import { Studio } from './pages/Studio';
import { StudioAnalytics } from './pages/StudioAnalytics';
import { StudioEarnings } from './pages/StudioEarnings';
import { StudioTitle } from './pages/StudioTitle';
import { Submit } from './pages/Submit';
import { TitlePage } from './pages/TitlePage';
import { Watch } from './pages/Watch';
import { Watchlist } from './pages/Watchlist';

/** Redirects signed-out visitors (to sign-in by default), remembering where they were headed. */
function RequireAuth({ children, to = '/signin' }: { children: ReactNode; to?: string }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={to} state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/create" element={<Record />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/search" element={<Search />} />
        <Route path="/t/:slug" element={<TitlePage />} />
        <Route path="/c/:handle" element={<CreatorPage />} />
        {/* Browsing is open; watching requires a free account. */}
        <Route
          path="/watch/:episodeId"
          element={
            <RequireAuth to="/signup">
              <Watch />
            </RequireAuth>
          }
        />
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
          path="/me/subscriptions"
          element={
            <RequireAuth>
              <MeSubscriptions />
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
        <Route path="/admin/accounts" element={<AdminAccounts />} />
        <Route path="/admin/scouts" element={<AdminScouts />} />
        <Route path="/admin/submissions" element={<AdminSubmissions />} />
        <Route path="/admin/moderation" element={<AdminModeration />} />
        <Route path="/admin/monetization" element={<AdminMonetization />} />
        <Route path="/admin/video" element={<AdminVideo />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/legal/terms" element={<Terms />} />
        <Route path="/legal/privacy" element={<Privacy />} />
        <Route path="/legal/cookies" element={<Cookies />} />
        <Route path="/legal/delete-account" element={<DeleteAccount />} />
        <Route path="/legal/ai" element={<AiDisclosure />} />
        <Route path="/legal/community-guidelines" element={<CommunityGuidelines />} />
        <Route path="/legal/creator-agreement" element={<CreatorAgreement />} />
        <Route path="/legal/scout-terms" element={<ScoutTerms />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
