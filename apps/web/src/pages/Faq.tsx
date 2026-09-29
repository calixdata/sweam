import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CREATOR_REVENUE_SHARE, MIN_AGE, MIN_PAYOUT_MILLICENTS, formatMillicents } from '@sweam/shared';
import { usePageTitle } from '../hooks';

const SHARE_PERCENT = Math.round(CREATOR_REVENUE_SHARE * 100);
const MIN_PAYOUT = formatMillicents(MIN_PAYOUT_MILLICENTS);

interface QA {
  q: string;
  a: ReactNode;
}

interface FaqGroup {
  id: string;
  heading: string;
  items: QA[];
}

const groups: FaqGroup[] = [
  {
    id: 'watching',
    heading: 'Watching Sweam',
    items: [
      {
        q: 'Is Sweam free?',
        a: 'Yes. Sweam is free to watch, supported by advertising. There is no subscription.',
      },
      {
        q: 'Do I need an account to watch?',
        a: (
          <>
            You can browse Sweam freely, but watching requires a free account. Creating one also adds
            a watchlist, continue-watching across devices, comments, following creators, and the tools
            for creators and scouts. You must be {MIN_AGE} or older to create one.
          </>
        ),
      },
      {
        q: 'What makes Sweam different?',
        a: (
          <>
            Sweam is where TikTok meets Tubi: a real streaming catalog where independent work sits
            beside everything else and is discovered on how much people actually finish it, not on
            follower counts. New work gets a fair look by design.
          </>
        ),
      },
    ],
  },
  {
    id: 'creators',
    heading: 'For creators',
    items: [
      {
        q: 'How do I get my work on Sweam?',
        a: (
          <>
            Two ways: submit finished work for review on the <Link to="/submit">Submit</Link> page,
            or publish directly through the Studio once you have a creator profile.
          </>
        ),
      },
      {
        q: 'How do creators earn?',
        a: (
          <>
            Creators keep <strong>{SHARE_PERCENT}%</strong> of the ad revenue their titles generate,
            one published split for everyone. Payouts unlock at {MIN_PAYOUT}. Eligibility and the
            full policy are in the <Link to="/legal/creator-agreement">Creator Agreement</Link>.
          </>
        ),
      },
      {
        q: 'Do I keep the rights to my work?',
        a: (
          <>
            Yes. You keep ownership and grant Sweam only a non-exclusive license to stream and
            promote your work while it is on the service, so you can distribute it elsewhere too. See
            the <Link to="/legal/creator-agreement">Creator Agreement</Link>.
          </>
        ),
      },
      {
        q: 'Can I use AI tools in my work?',
        a: (
          <>
            You can, within the rules in the <Link to="/legal/ai">AI Disclosure</Link>: hold the
            rights, disclose misleading synthetic media, and never depict a real person without
            consent.
          </>
        ),
      },
    ],
  },
  {
    id: 'scouts',
    heading: 'For networks and scouts',
    items: [
      {
        q: 'What is the scout portal?',
        a: (
          <>
            A place for networks and buyers to discover breakout independent work with real
            performance data. Creators opt titles in; scouts see stats and can express interest. Any
            resulting deal is directly between the creator and the network, and Sweam takes no cut.
          </>
        ),
      },
      {
        q: 'How do I get scout access?',
        a: (
          <>
            Request it from the <Link to="/scout">Scout</Link> page with your organization details.
            Access is reviewed before it is granted.
          </>
        ),
      },
    ],
  },
  {
    id: 'privacy-safety',
    heading: 'Privacy and safety',
    items: [
      {
        q: 'What data does Sweam collect?',
        a: (
          <>
            As little as it can. One essential sign-in cookie, and privacy-first, cookieless
            analytics only if you allow them. Details are in the{' '}
            <Link to="/legal/privacy">Privacy Policy</Link> and{' '}
            <Link to="/legal/cookies">Cookie Policy</Link>.
          </>
        ),
      },
      {
        q: 'How do I report something?',
        a: (
          <>
            Use the report control on any title or comment. For copyright, email dmca@sweam.co. See
            the <Link to="/legal/community-guidelines">Community Guidelines</Link> for what is and
            is not allowed.
          </>
        ),
      },
    ],
  },
];

export function Faq() {
  usePageTitle('FAQ');
  return (
    <div className="page page-narrow">
      <h1>Frequently asked questions</h1>
      <p className="page-intro">
        Short answers about watching Sweam, publishing on it, the scout portal, and how we handle
        your data. Need something else? See <Link to="/contact">Contact</Link>.
      </p>

      <nav className="legal-toc" aria-label="On this page">
        <h2>Topics</h2>
        <ol>
          {groups.map((group) => (
            <li key={group.id}>
              <a href={`#${group.id}`}>{group.heading}</a>
            </li>
          ))}
        </ol>
      </nav>

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={group.id} className="faq-group">
          <h2 id={group.id}>{group.heading}</h2>
          <dl className="faq-list">
            {group.items.map((item) => (
              <div key={item.q} className="faq-item">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
