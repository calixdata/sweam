import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks';
import { CONTACT, MailLink, OPERATOR, SERVICE } from './legal/LegalDoc';

interface Desk {
  address: string;
  label: string;
  detail: string;
}

const desks: Desk[] = [
  {
    address: CONTACT.support,
    label: 'General and creator support',
    detail: 'Questions about your account, watching, publishing, or payouts.',
  },
  {
    address: CONTACT.privacy,
    label: 'Privacy and data requests',
    detail: 'Access, correct, export, or delete your data, and any privacy question.',
  },
  {
    address: CONTACT.dmca,
    label: 'Copyright and DMCA',
    detail: 'Copyright takedown notices and counter-notices.',
  },
  {
    address: CONTACT.legal,
    label: 'Legal',
    detail: 'Legal notices and questions about our policies.',
  },
];

export function Contact() {
  usePageTitle('Contact');
  return (
    <div className="page page-narrow">
      <h1>Contact {SERVICE}</h1>
      <p className="page-intro">
        {OPERATOR} operates {SERVICE}. Reach the right desk below. We aim to respond within a few
        business days; privacy and copyright requests are handled within the timeframes the law
        requires.
      </p>

      <section aria-labelledby="desks-heading">
        <h2 id="desks-heading">Email us</h2>
        <dl className="contact-list">
          {desks.map((desk) => (
            <div key={desk.address} className="contact-item">
              <dt>
                {desk.label}: <MailLink address={desk.address} />
              </dt>
              <dd>{desk.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="inapp-heading">
        <h2 id="inapp-heading">Faster ways, in the app</h2>
        <ul>
          <li>
            Creators: submit finished work on <Link to="/submit">Submit</Link>, or publish and track
            earnings in the Studio.
          </li>
          <li>
            Networks and buyers: request access on the <Link to="/scout">Scout</Link> page.
          </li>
          <li>
            Reporting content: use the report control on any title or comment. Serious safety
            concerns can also go to <MailLink address={CONTACT.support} />.
          </li>
          <li>
            Common questions are answered on the <Link to="/faq">FAQ</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}
