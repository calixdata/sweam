import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks';

/**
 * Shared shell and single source of truth for Sweam's policy pages. Every legal
 * document is authored as a list of sections and rendered here so the draft
 * notice, contact block, "on this page" navigation, and section anchors stay
 * identical across Terms, Privacy, Cookies, the AI disclosure, and the
 * agreements. Section bodies are arbitrary JSX so real links and lists survive.
 */

/** Who operates the service and how to reach the right desk. Used everywhere.
 *  Sweam is owned and operated by Falcyn Inc (doing business as Sweam). */
export const OPERATOR = 'Falcyn Inc';
export const SERVICE = 'Sweam';
export const GOVERNING_STATE = 'Delaware';

export const CONTACT = {
  support: 'support@sweam.co',
  privacy: 'privacy@sweam.co',
  dmca: 'dmca@sweam.co',
  legal: 'legal@sweam.co',
} as const;

/** These are drafts prepared for review, not documents that are in effect yet. */
export const PREPARED = 'September 20, 2026';
export const DRAFT_VERSION = 'v0.1';

export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

/** A plain mailto link, used across the policy pages and the contact page. */
export function MailLink({ address }: { address: string }) {
  return <a href={`mailto:${address}`}>{address}</a>;
}

/**
 * The honest, unmissable banner: these documents were prepared for Sweam but
 * have not been reviewed by counsel and are not legal advice.
 */
export function DraftNotice() {
  return (
    <aside className="notice notice-draft" role="note" aria-label="Draft status">
      <strong>Draft for review.</strong> This document was prepared as a working template for{' '}
      {SERVICE} and has <strong>not yet been reviewed by legal counsel</strong>. It is not in effect
      and is not legal advice. Have a qualified attorney review and adapt it before {SERVICE} relies
      on it publicly.
    </aside>
  );
}

export function LegalDoc({
  title,
  summary,
  sections,
  contact = CONTACT.legal,
  updated = PREPARED,
}: {
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  /** The best inbox for questions about this specific document. */
  contact?: string;
  updated?: string;
}) {
  usePageTitle(title);
  return (
    <article className="page page-narrow legal-doc">
      <h1>{title}</h1>
      <p className="legal-meta">
        Prepared {updated} · Draft {DRAFT_VERSION}
      </p>
      <DraftNotice />
      <p className="page-intro">{summary}</p>

      <nav className="legal-toc" aria-label="On this page">
        <h2>On this page</h2>
        <ol>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.heading}</a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="legal-section">
          <h2 id={section.id}>{section.heading}</h2>
          {section.body}
        </section>
      ))}

      <section aria-labelledby="legal-contact" className="legal-section">
        <h2 id="legal-contact">Questions</h2>
        <p>
          Questions about this document go to <MailLink address={contact} />. For anything else, see{' '}
          <Link to="/contact">Contact</Link>. {OPERATOR} (doing business as {SERVICE}) operates{' '}
          {SERVICE}.
        </p>
      </section>
    </article>
  );
}
