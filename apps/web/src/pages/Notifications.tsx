import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationItem } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Notifications() {
  usePageTitle('Notifications');
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ notifications: NotificationItem[] }>('/api/me/notifications')
      .then(async (data) => {
        if (cancelled) return;
        // Show the list with its "New" tags, then clear the unread state so
        // the nav badge resets on the next navigation.
        setItems(data.notifications);
        if (data.notifications.some((item) => !item.read)) {
          await apiSend('POST', '/api/me/notifications/read-all');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!items) return <Loading label="Loading notifications" />;

  return (
    <div className="page page-narrow">
      <h1>Notifications</h1>
      {items.length === 0 ? (
        <p>Nothing yet. Scout activity, moderation decisions, and account updates land here.</p>
      ) : (
        <ul className="notification-list">
          {items.map((item) => (
            <li key={item.id} className={item.read ? '' : 'notification-unread'}>
              {!item.read && <span className="tag-new">New</span>}
              <p>
                {item.body}{' '}
                {item.link && <Link to={item.link}>Open</Link>}
              </p>
              <p className="card-meta">{item.createdAt.slice(0, 10)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
