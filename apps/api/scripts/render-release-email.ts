// Render sample release emails to HTML files for visual review.
// Usage: npx tsx scripts/render-release-email.ts <outDir>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnnouncementContent } from '../src/lib/release';
import { releaseEmail } from '../src/lib/release';

const out = process.argv[2] ?? '.';
const site = 'https://sweam.co';
const unsubscribeUrl = 'https://sweam.co/api/email/unsubscribe?u=usr_x&t=0123456789abcdef0123456789abcdef0123456789abcdef';

const episode: AnnouncementContent = {
  title: {
    id: 'ttl', name: 'Scion Saga', slug: 'scion-saga-wloy01', kind: 'series',
    synopsis: "Sixteen-year-old Adam Caspian's world changes when hidden powers awaken, and a mysterious classmate seems to know why.",
    poster_url: '/media/sub/fd2f2552-8db4-4990-b081-6235e75d2d20/84de2d05-7a76-4c58-a40c-29939a7d5abf/scion-saga-e01-sweam-cover-portrait.png',
    hero_url: null, is_blu: 0, blu_price_cents: null, creator_id: 'c', creator_name: 'Scion Saga', creator_handle: 'scionsaga', episode_count: 5,
  },
  episodes: [{ id: '3d351a04-ae69-4616-94ed-bf3c87c47085', season: 1, episode: 4, name: 'Unnecessary Exposure', synopsis: 'Adam learns his powers leave a trace, and someone has started following it.', thumbnail_url: '/media/u/fd2f2552-8db4-4990-b081-6235e75d2d20/f01873fe-06f3-4283-a541-c2fdcd6c4d11/episode-4.png' }],
};

for (const [name, opts] of [
  ['episode-member', { content: episode, reason: 'member', canWatch: true }],
  ['episode-reminder', { content: episode, reason: 'reminder', canWatch: true }],
] as const) {
  const m = releaseEmail({ site, recipientName: 'Calix', unsubscribeUrl, postalAddress: undefined, ...opts });
  writeFileSync(join(out, `${name}.html`), m.html);
  writeFileSync(join(out, `${name}.txt`), `Subject: ${m.subject}\n\n${m.text}`);
  console.log(name, '|', m.subject);
}
