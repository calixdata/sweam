import { Link } from 'react-router-dom';
import { CONTACT, LegalDoc, MailLink, SERVICE } from './LegalDoc';

/** How to delete a Sweam account and what happens to the data (linked from the app stores). */
export function DeleteAccount() {
  return (
    <LegalDoc
      title="Delete your account"
      contact={CONTACT.privacy}
      updated="October 5, 2026"
      summary={
        <>
          You can delete your {SERVICE} account yourself at any time, from the website or the app.
          Deletion is permanent and takes effect immediately.
        </>
      }
      sections={[
        {
          id: 'how',
          heading: '1. How to delete your account',
          body: (
            <>
              <p>
                On the website: sign in, open <Link to="/settings">Settings</Link>, scroll to{' '}
                <strong>Delete account</strong>, enter your password, type DELETE, and confirm.
              </p>
              <p>
                In the app: open the <strong>Me</strong> tab, then <strong>Profile &amp; account</strong>,
                scroll to <strong>Delete account</strong>, enter your password, and confirm.
              </p>
              <p>
                If you cannot sign in, email <MailLink address={CONTACT.privacy} /> from the address
                on the account and we will delete it for you within 30 days.
              </p>
            </>
          ),
        },
        {
          id: 'what',
          heading: '2. What is deleted',
          body: (
            <p>
              Your account, profile and profile picture, every title, episode and clip you published,
              your comments, likes, follows, watchlist and viewing history, notifications, scout
              application and membership, and any identity verification record. Active Sweam Blu or
              Scout subscriptions are canceled at the same time; charges already made are not
              refunded.
            </p>
          ),
        },
        {
          id: 'kept',
          heading: '3. What may be kept',
          body: (
            <p>
              Records we must keep to comply with the law or resolve disputes, such as payment and
              payout history and moderation decisions, are kept for as long as the law requires and
              then removed. They are no longer linked to a usable account.
            </p>
          ),
        },
      ]}
    />
  );
}
