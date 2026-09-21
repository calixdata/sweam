# Policies and compliance

Sweam's user-facing policies live in the app as real pages and in this repo as
their source. Sweam is operated by **Falcyn**, is for **adults (18+)**, and is
built to collect as little as it can.

> **Draft status.** These documents are working drafts prepared for Sweam. They
> have **not been reviewed by legal counsel**, are not yet in effect, and are
> not legal advice. Every page shows this notice at the top. Have a qualified
> attorney review and adapt them before relying on them publicly.

## The documents

| Document | Live page | Source |
| --- | --- | --- |
| Terms of Service | https://sweam.co/legal/terms | [Terms.tsx](../apps/web/src/pages/legal/Terms.tsx) |
| Privacy Policy | https://sweam.co/legal/privacy | [Privacy.tsx](../apps/web/src/pages/legal/Privacy.tsx) |
| Cookie Policy | https://sweam.co/legal/cookies | [Cookies.tsx](../apps/web/src/pages/legal/Cookies.tsx) |
| AI Disclosure | https://sweam.co/legal/ai | [AiDisclosure.tsx](../apps/web/src/pages/legal/AiDisclosure.tsx) |
| Community Guidelines | https://sweam.co/legal/community-guidelines | [CommunityGuidelines.tsx](../apps/web/src/pages/legal/CommunityGuidelines.tsx) |
| Creator Agreement | https://sweam.co/legal/creator-agreement | [CreatorAgreement.tsx](../apps/web/src/pages/legal/CreatorAgreement.tsx) |
| FAQ | https://sweam.co/faq | [Faq.tsx](../apps/web/src/pages/Faq.tsx) |
| Contact | https://sweam.co/contact | [Contact.tsx](../apps/web/src/pages/Contact.tsx) |

## How they are built

Every policy is rendered through one shared component,
[LegalDoc.tsx](../apps/web/src/pages/legal/LegalDoc.tsx), so the draft notice,
"on this page" navigation, section anchors, and contact block stay identical
across documents. The operator name, governing-law state, and contact addresses
are defined once there. Figures that also appear in code (the 55% creator share,
the $10 payout minimum, the monetization thresholds) are imported from
[`@sweam/shared`](../packages/shared/src/money.ts) so the policy text cannot
drift from what the product actually does.

## Cookies, consent, and analytics

- **One essential cookie** (`sweam_session`) keeps you signed in. It needs no
  consent and holds no personal data.
- **First-party, cookieless analytics** only runs after the visitor allows it in
  the consent banner. It honors Do-Not-Track and Global Privacy Control, sets no
  cookies, and stores no IP address or user agent. See
  [consent.ts](../apps/web/src/consent.ts),
  [analytics.ts](../apps/web/src/analytics.ts),
  [CookieConsent.tsx](../apps/web/src/components/CookieConsent.tsx), and the
  collector in [apps/analytics](../apps/analytics/README.md).

Contact desks (`support@`, `privacy@`, `dmca@`, `legal@sweam.co`) route through
Cloudflare catch-all email.

## Before launch: what counsel should confirm

- Governing law, venue, and dispute-resolution terms (Terms of Service, section
  on governing law).
- The exact operating entity name and any required business address.
- DMCA designated-agent registration for the address in the Terms.
- Age and privacy posture (18+, COPPA, and regional consent ages).
- Payout tax handling and the payment provider's terms (Creator Agreement).
