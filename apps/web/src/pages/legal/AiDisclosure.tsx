import { Link } from 'react-router-dom';
import { CONTACT, LegalDoc, OPERATOR, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

const sections: LegalSection[] = [
  {
    id: 'principle',
    heading: '1. Our principle',
    body: (
      <p>
        {SERVICE} is a home for work made by people. We use automated systems where they help
        viewers find good work and keep the service safe, and we tell you where and how. We do not
        hide behind a black box, and we do not pass off machines as audiences or creators.
      </p>
    ),
  },
  {
    id: 'discovery',
    heading: '2. How discovery works',
    body: (
      <p>
        Titles are ranked by a transparent, rules-based system: a smoothed finish rate (how much of
        a title people actually watch), a measured amount of exploration so new work gets a fair
        look, and a freshness factor. Every ranked title carries a plain-language reason for where it
        landed. There is no opaque machine-learning model profiling you, and rankings are not based
        on who you are. The method is described in the public{' '}
        <a href="https://github.com/calixdata/sweam/blob/main/docs/ARCHITECTURE.md">
          architecture notes
        </a>
        .
      </p>
    ),
  },
  {
    id: 'earnings',
    heading: '3. Earnings are computed by fixed rules',
    body: (
      <p>
        Creator eligibility and the revenue share are deterministic: published thresholds and a
        fixed split, evaluated the same way for everyone, not a discretionary or predictive score.
        The rules are in the <Link to="/legal/creator-agreement">Creator Agreement</Link> and the
        public Creator Program document.
      </p>
    ),
  },
  {
    id: 'moderation',
    heading: '4. Automated help in moderation',
    body: (
      <p>
        We may use automated signals to flag content for review (for example, to triage reports or
        detect likely abuse). Consequential actions such as removing a title, issuing a strike, or
        suspending an account involve human judgment, and creators are notified and can respond.
      </p>
    ),
  },
  {
    id: 'creator-ai',
    heading: '5. AI-generated content on Sweam',
    body: (
      <>
        <p>
          You may use AI tools in your creative process. When you do, the same rules apply as to any
          other work, plus a few specific ones:
        </p>
        <ul>
          <li>
            <strong>You must hold or clear all rights</strong> in the inputs and the output, and you
            are responsible for the result.
          </li>
          <li>
            <strong>Disclose synthetic media that could mislead.</strong> If a work uses AI to
            realistically depict real people or events in a way a viewer could mistake for genuine
            footage, label it clearly.
          </li>
          <li>
            <strong>No non-consensual likeness.</strong> Do not use AI to depict a real, identifiable
            person without their consent, and never to impersonate, defame, or sexualize someone.
          </li>
          <li>
            Content that breaks these rules or the{' '}
            <Link to="/legal/community-guidelines">Community Guidelines</Link> may be removed.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'your-data',
    heading: '6. Your data and AI models',
    body: (
      <p>
        {OPERATOR} does not sell your personal data, and we do not hand your personal data to third
        parties to train their AI models. Any automated systems we run operate on the data described
        in the <Link to="/legal/privacy">Privacy Policy</Link> for the purposes stated there.
      </p>
    ),
  },
  {
    id: 'this-document',
    heading: '7. About this site’s text',
    body: (
      <p>
        In the interest of full disclosure: parts of {SERVICE}'s site copy and these policy drafts
        were prepared with the assistance of AI writing tools and are reviewed by people. As the
        notice at the top says, the legal documents still require review by counsel before {SERVICE}{' '}
        relies on them.
      </p>
    ),
  },
];

export function AiDisclosure() {
  return (
    <LegalDoc
      title="AI Disclosure"
      contact={CONTACT.support}
      summary={
        <>
          Where and how {SERVICE} uses automated systems, what we ask of creators who use AI tools,
          and what we will not do with your data. Plainly stated, because trust depends on it.
        </>
      }
      sections={sections}
    />
  );
}
