import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks';

export function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="page page-narrow">
      <h1>Page not found</h1>
      <p>
        That page does not exist. Head back to the <Link to="/">home page</Link> or browse{' '}
        <Link to="/discover">Discover</Link>.
      </p>
    </div>
  );
}
