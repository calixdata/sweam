import { Link } from 'react-router-dom';
import { CONTACT, LegalDoc, MailLink, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

const sections: LegalSection[] = [
  {
    id: 'purpose',
    heading: '1. What these guidelines are for',
    body: (
      <p>
        {SERVICE} works when it is a place for real work and a respectful audience. These guidelines
        apply to everything on the service: titles and episodes, creator profiles, comments, and
        submissions. They sit alongside the <Link to="/legal/terms">Terms of Service</Link>.
      </p>
    ),
  },
  {
    id: 'not-allowed',
    heading: '2. Content that is not allowed',
    body: (
      <>
        <p>Do not upload, post, or link to:</p>
        <ul>
          <li>anything unlawful, or content you do not have the rights to distribute;</li>
          <li>
            child sexual abuse material or any content that sexualizes minors. We remove it, preserve
            what the law requires, report it to the authorities, and ban the account;
          </li>
          <li>
            pornographic, sexually explicit, or non-consensual intimate content of any kind (see
            the permanent-ban note under enforcement);
          </li>
          <li>
            hate speech that attacks people based on protected characteristics, or content that
            promotes or celebrates violence against them;
          </li>
          <li>harassment, bullying, credible threats, or the sharing of private information (doxxing);</li>
          <li>graphic gore glorifying violence, or content that encourages self-harm;</li>
          <li>
            dangerous misinformation likely to cause real-world harm, scams, spam, or malware;
          </li>
          <li>
            impersonation, or synthetic media that realistically depicts real people or events
            without the disclosure required by the{' '}
            <Link to="/legal/ai">AI Disclosure</Link>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'ratings',
    heading: '3. Mature content and accurate ratings',
    body: (
      <p>
        {SERVICE} is an adult (18+) service and mature storytelling is welcome within the rules
        above. Every submission requires an honest viewer rating (G, PG, PG-13, R, NC-17), which
        maps to the catalog advisory. Rate accurately: mislabeling is a violation. The rating is a
        maturity signal only, not a licence for anything above these rules.{' '}
        <strong>Explicit or pornographic content is forbidden at every rating.</strong>
      </p>
    ),
  },
  {
    id: 'authenticity',
    heading: '4. Authenticity',
    body: (
      <p>
        Discovery on {SERVICE} rewards work people actually finish, so keeping the signals honest
        matters. Do not manipulate views, finish rates, likes, followers, or earnings; do not use
        bots or fake engagement; and do not repost or rip other people's work as your own.
      </p>
    ),
  },
  {
    id: 'comments',
    heading: '5. Comments and community',
    body: (
      <p>
        Discuss and disagree, but keep it civil. No harassment, hate, spam, or off-topic promotion.
        Creators can moderate comments on their own titles, and everyone can report a comment.
        Removed comments are shown as placeholders only where needed to keep a reply thread readable.
      </p>
    ),
  },
  {
    id: 'enforcement',
    heading: '6. How we enforce this',
    body: (
      <>
        <p>
          When content is reported or detected, we review it and may remove it, issue a strike, or,
          for serious or repeated violations, suspend or terminate the account. Copyright is handled
          through the takedown process in the <Link to="/legal/terms">Terms</Link>.
        </p>
        <p>
          <strong>
            Submitting or uploading forbidden content — sexual content involving minors,
            pornographic or explicit material, or non-consensual intimate imagery — results in
            immediate removal and a permanent account ban, not a strike.
          </strong>
        </p>
        <p>
          Strikes are cumulative: <strong>three active strikes suspend a creator's publishing and
          uploads</strong>. We notify creators of actions against their work, and you can appeal a
          decision by replying to that notice or emailing <MailLink address={CONTACT.support} />.
        </p>
      </>
    ),
  },
  {
    id: 'reporting',
    heading: '7. How to report something',
    body: (
      <p>
        Use the report control on a title or comment to flag spam, abuse, or other issues. For
        copyright, email <MailLink address={CONTACT.dmca} />. For urgent safety concerns, contact{' '}
        <MailLink address={CONTACT.support} /> and, where someone is in danger, your local
        emergency services.
      </p>
    ),
  },
];

export function CommunityGuidelines() {
  return (
    <LegalDoc
      title="Community Guidelines"
      contact={CONTACT.support}
      summary={
        <>
          The rules of the road for {SERVICE}: what belongs here, what does not, and how we keep the
          catalog and the conversation trustworthy.
        </>
      }
      sections={sections}
    />
  );
}
