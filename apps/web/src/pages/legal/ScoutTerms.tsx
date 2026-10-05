import {
  SCOUT_ALL_ACCESS_CENTS,
  SCOUT_BETA_FREE_LIMIT,
  SCOUT_BETA_TRIAL_DAYS,
  formatUsdCents,
} from '@sweam/shared';
import { CONTACT, GOVERNING_STATE, LegalDoc, MailLink, OPERATOR, SERVICE } from './LegalDoc';

/** Scout Program membership terms. Draft, rendered through the shared LegalDoc shell. */
export function ScoutTerms() {
  const price = formatUsdCents(SCOUT_ALL_ACCESS_CENTS);
  return (
    <LegalDoc
      title="Scout Program Terms"
      contact={CONTACT.legal}
      updated="October 5, 2026"
      summary={
        <>
          These terms govern membership in the {SERVICE} Scout Program, including who may join, the
          monthly fee and the first-{SCOUT_BETA_FREE_LIMIT} free trial, billing and cancellation, and
          how your organization appears to creators.
        </>
      }
      sections={[
        {
          id: 'program',
          heading: '1. The Scout Program',
          body: (
            <p>
              The {SERVICE} Scout Program gives approved organizations access to the scout portal:
              ranked momentum boards, per-title one-sheets for creators who opt in, the ability to
              send creators sign and promotion offers, and all-access to {SERVICE} Blu content. A
              scout account represents your organization, not an individual person.
            </p>
          ),
        },
        {
          id: 'eligibility',
          heading: '2. Eligibility and your work email',
          body: (
            <p>
              Scout accounts are for networks, studios, distributors, aggregators, and similar
              organizations. You must apply with a valid work email on your organization&apos;s
              domain. Free or consumer email providers, for example Gmail, Yahoo, Outlook, and
              iCloud, are not accepted. You confirm that you are authorized to represent the
              organization you name.
            </p>
          ),
        },
        {
          id: 'approval',
          heading: '3. Provisional approval',
          body: (
            <p>
              Approval is provisional. When you submit a complete application with a work email,
              accepted terms, and a card on file, your scout access begins automatically. {SERVICE}{' '}
              may review, confirm, suspend, or revoke any provisional account at any time, including
              if your organization or role cannot be verified.
            </p>
          ),
        },
        {
          id: 'fees',
          heading: '4. Membership fee and the first-50 free trial',
          body: (
            <p>
              Scout membership is {price} per month and includes all-access to {SERVICE} Blu
              content; there is no separate Blu fee for scouts. During the beta, the first{' '}
              {SCOUT_BETA_FREE_LIMIT} scouts receive their first {SCOUT_BETA_TRIAL_DAYS} days free,
              applied automatically. If you are one of the first {SCOUT_BETA_FREE_LIMIT}, a card
              placed on file is not charged until the {SCOUT_BETA_TRIAL_DAYS}-day free period ends,
              after which membership renews at {price} per month unless you cancel. A scout that{' '}
              {SERVICE} approves without a card on file receives the same free period and must add
              a card before it ends to keep access. This introductory price applies while{' '}
              {SERVICE} is being seeded and may change for future terms with notice.
            </p>
          ),
        },
        {
          id: 'billing',
          heading: '5. Billing, renewal, and cancellation',
          body: (
            <p>
              Membership renews automatically each month. You may cancel at any time from your
              account. To avoid being charged for the next period, you must cancel at least 24
              business hours before your renewal date; a cancellation made inside that window takes
              effect at the following renewal. Fees already charged are not refundable except where
              required by law.
            </p>
          ),
        },
        {
          id: 'use',
          heading: '6. Acceptable use of scout data',
          body: (
            <p>
              You agree to use scout data, including boards, one-sheets, retention and finish
              metrics, and creator contact details, only to evaluate and pursue legitimate
              opportunities with creators. You will not scrape, resell, or redistribute {SERVICE}{' '}
              data, contact creators for purposes unrelated to their work on {SERVICE}, or
              misrepresent your organization.
            </p>
          ),
        },
        {
          id: 'creators',
          heading: '7. What creators see',
          body: (
            <p>
              Creators control whether their titles appear in the scout portal. When you open a
              creator&apos;s one-sheet, that view is logged and shown to the creator, along with your
              organization name. When you express interest or send an offer, the creator receives
              your organization and contact details.
            </p>
          ),
        },
        {
          id: 'revocation',
          heading: '8. Suspension and revocation',
          body: (
            <p>
              {SERVICE} may suspend or revoke scout access for a breach of these terms, misuse of
              data, a failed or disputed payment, or to protect creators or the platform. If your
              access is revoked, any active membership may be canceled without a refund of the
              current period.
            </p>
          ),
        },
        {
          id: 'changes',
          heading: '9. Changes to these terms',
          body: (
            <p>
              {SERVICE} may update these terms. Material changes will be communicated before they
              take effect, and continued use of a scout account afterward means you accept them. For
              questions, contact <MailLink address={CONTACT.legal} />.
            </p>
          ),
        },
        {
          id: 'law',
          heading: '10. Governing law',
          body: (
            <p>
              These terms are governed by the laws of the State of {GOVERNING_STATE}, without regard
              to its conflict-of-laws rules. {OPERATOR} operates {SERVICE}.
            </p>
          ),
        },
      ]}
    />
  );
}
