import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks';

export function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="page page-narrow notfound">
      <p className="notfound-code" aria-hidden="true">
        404
      </p>
      <h1>We lost that reel</h1>
      <p className="page-intro">
        The page you were looking for isn&rsquo;t here. It may have been moved, unpublished, or never
        existed.
      </p>
      <div className="notfound-actions">
        <Link className="button" to="/">
          Back to home
        </Link>
        <Link className="button button-quiet" to="/discover">
          Discover
        </Link>
        <Link className="button button-quiet" to="/browse">
          Browse
        </Link>
      </div>
      <p>
        Or <Link to="/submit">submit your own work</Link>.
      </p>
    </div>
  );
}
