import { NavLink } from 'react-router-dom';

/** The admin area's sections, in the order they appear as tabs. */
const SECTIONS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/accounts', label: 'Accounts' },
  { to: '/admin/scouts', label: 'Scouts' },
  { to: '/admin/submissions', label: 'Submissions' },
  { to: '/admin/moderation', label: 'Moderation' },
  { to: '/admin/monetization', label: 'Monetization' },
  { to: '/admin/video', label: 'Video' },
];

/**
 * Tab strip shown at the top of every admin page so each section is one click
 * away from any other. The current tab is announced through aria-current.
 */
export function AdminNav() {
  return (
    <nav aria-label="Admin sections" className="admin-nav">
      <ul>
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <NavLink to={section.to} end={section.to === '/admin'}>
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
