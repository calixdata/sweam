import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { trackPageView } from '../analytics';
import { apiGet } from '../api';
import { useAuth } from '../auth';
import { resetConsent } from '../consent';
import { Avatar } from './Avatar';
import { CookieConsent } from './CookieConsent';
import { ScoutBadge } from './ScoutBadge';

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);
  const [unread, setUnread] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

  // Refresh the notifications badge on every navigation; a stale badge is
  // worse than one extra count query.
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    apiGet<{ unread: number }>('/api/me/notifications/unread-count')
      .then((data) => {
        if (!cancelled) setUnread(data.unread);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, location.pathname]);

  // On SPA navigation, move focus to the main landmark so screen reader and
  // keyboard users land at the new page content instead of staying mid-header.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  // Record a privacy-first page view on each navigation. The analytics client
  // is a no-op unless the visitor has consented (and only on the real origin).
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  // admin.sweam.co is a dedicated entrance: land its root on the admin area.
  useEffect(() => {
    if (window.location.hostname === 'admin.sweam.co' && location.pathname === '/') {
      navigate('/admin', { replace: true });
    }
  }, [location.pathname, navigate]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      setSearchTerm('');
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Sweam home">
            <img className="brand-logo" src="/brand/sweam-logo.png" alt="Sweam" />
          </Link>
          <nav aria-label="Primary">
            <ul className="nav-links">
              <li>
                <NavLink to="/" end>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to="/discover">Discover</NavLink>
              </li>
              <li>
                <NavLink to="/browse">Browse</NavLink>
              </li>
              <li>
                <NavLink to="/submit">Submit</NavLink>
              </li>
              {user && (
                <li>
                  <NavLink to="/create">Create</NavLink>
                </li>
              )}
              {user && (
                <li>
                  <NavLink to="/watchlist">My list</NavLink>
                </li>
              )}
            </ul>
          </nav>
          <nav aria-label="Workspaces">
            <ul className="nav-links nav-links-secondary">
              {user && (
                <li>
                  <NavLink
                    to="/notifications"
                    aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                  >
                    Notifications{unread > 0 ? ` (${unread})` : ''}
                  </NavLink>
                </li>
              )}
              {user && (
                <li>
                  <NavLink to="/studio">Studio</NavLink>
                </li>
              )}
              <li>
                <NavLink to="/scout">Scout</NavLink>
              </li>
              {user?.isAdmin && (
                <li>
                  <NavLink to="/admin">Admin</NavLink>
                </li>
              )}
              {user && (
                <li>
                  <NavLink to="/settings" aria-label={user.username ? `Settings, @${user.username}` : 'Settings'}>
                    {user.username ? `@${user.username}` : 'Settings'}
                  </NavLink>
                </li>
              )}
            </ul>
          </nav>
          <form role="search" className="header-search" onSubmit={handleSearch}>
            <label htmlFor="header-search-input" className="visually-hidden">
              Search titles and creators
            </label>
            <input
              id="header-search-input"
              type="search"
              placeholder="Search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </form>
          <div className="header-account">
            {user ? (
              <>
                <Avatar src={user.avatarUrl} name={user.displayName} size={32} />
                <span className="nav-user">{user.displayName}</span>
                {user.scout?.status === 'approved' && <ScoutBadge />}
                <button type="button" className="button button-quiet" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link className="button button-quiet" to="/signin">
                  Sign in
                </Link>
                <Link className="button" to="/signup">
                  Join Sweam
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <img className="footer-logo" src="/brand/sweam-logo.png" alt="Sweam" />
            <p className="footer-tagline">
              Where TikTok meets Tubi. Free streaming and equal-visibility discovery for independent
              creators.
            </p>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            <div className="footer-col">
              <h2>Explore</h2>
              <ul>
                <li>
                  <Link to="/">Home</Link>
                </li>
                <li>
                  <Link to="/discover">Discover</Link>
                </li>
                <li>
                  <Link to="/browse">Browse</Link>
                </li>
                <li>
                  <Link to="/faq">FAQ</Link>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h2>Creators</h2>
              <ul>
                <li>
                  <Link to="/submit">Submit your work</Link>
                </li>
                <li>
                  <Link to="/scout">Scout portal</Link>
                </li>
                <li>
                  <Link to="/legal/creator-program">Creator Program and Blu Fund</Link>
                </li>
                <li>
                  <Link to="/legal/creator-agreement">Creator Agreement</Link>
                </li>
                <li>
                  <Link to="/legal/community-guidelines">Community Guidelines</Link>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h2>Company</h2>
              <ul>
                <li>
                  <Link to="/contact">Contact</Link>
                </li>
                <li>
                  <Link to="/legal/terms">Terms of Service</Link>
                </li>
                <li>
                  <Link to="/legal/privacy">Privacy Policy</Link>
                </li>
                <li>
                  <Link to="/legal/cookies">Cookie Policy</Link>
                </li>
                <li>
                  <Link to="/legal/ai">AI Disclosure</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="footer-legal">
          <p>© 2026 Falcyn Inc dba Sweam.</p>
          <button type="button" className="footer-cookie-button" onClick={resetConsent}>
            Cookie settings
          </button>
        </div>
      </footer>
      <CookieConsent />
    </>
  );
}
