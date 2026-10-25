import { describe, expect, it } from 'vitest';
import { mapBatchIds } from '../src/lib/email';
import type { AnnouncementContent } from '../src/lib/release';
import { announcementHeadline, emailImageUrl, releaseEmail } from '../src/lib/release';

const SITE = 'https://sweam.co';

type TitleOverrides = Partial<AnnouncementContent['title']>;

function series(episodes: { id: string; episode: number; name: string }[], overrides: TitleOverrides = {}): AnnouncementContent {
  return {
    title: {
      id: 'ttl_scion',
      name: 'Scion Saga',
      slug: 'scion-saga-wloy01',
      kind: 'series',
      synopsis: 'Sixteen-year-old Adam Caspian finds hidden powers.',
      poster_url: '/media/u/a/b/poster.png',
      hero_url: null,
      is_blu: 0,
      blu_price_cents: null,
      admin_locked: 0,
      creator_id: 'usr_creator',
      creator_name: 'Scion Saga',
      creator_handle: 'scionsaga',
      creator_official: 1,
      creator_verified: 1,
      episode_count: 5,
      visible: 1,
      ...overrides,
    },
    episodes: episodes.map((e) => ({ id: e.id, season: 1, episode: e.episode, name: e.name, synopsis: `About ${e.name}.`, thumbnail_url: '/media/u/a/b/ep.png' })),
  };
}

const film: AnnouncementContent = {
  title: {
    id: 'ttl_spring',
    name: 'Spring',
    slug: 'spring',
    kind: 'film',
    synopsis: 'A shepherd girl and her dog face ancient spirits.',
    poster_url: '/media/u/x/y/spring.jpg',
    hero_url: '/media/u/x/y/spring-wide.jpg',
    is_blu: 0,
    blu_price_cents: null,
    admin_locked: 1,
    creator_id: 'usr_blender',
    creator_name: 'Blender Studio',
    creator_handle: 'blender',
    creator_official: 0,
    creator_verified: 0,
    episode_count: 1,
    visible: 1,
  },
  episodes: [{ id: 'ep_spring', season: 1, episode: 1, name: 'Spring', synopsis: '', thumbnail_url: null }],
};

const base = { site: SITE, recipientName: 'Calix', unsubscribeUrl: 'https://sweam.co/api/email/unsubscribe?u=usr_1&t=abc', canWatch: true } as const;

describe('announcementHeadline', () => {
  it('reads a standalone film as new on Sweam', () => {
    expect(announcementHeadline(film).subject).toBe('New on Sweam: Spring');
  });
  it('names a single series episode', () => {
    expect(announcementHeadline(series([{ id: 'e4', episode: 4, name: 'Unnecessary Exposure' }])).subject).toBe(
      'Out now: Scion Saga, S1 E4: Unnecessary Exposure',
    );
  });
  it('counts several episodes released together', () => {
    const h = announcementHeadline(series([{ id: 'e4', episode: 4, name: 'A' }, { id: 'e5', episode: 5, name: 'B' }]));
    expect(h.subject).toBe('Out now: Scion Saga, 2 new episodes');
    expect(h.notice).toBe('Out now: Scion Saga, 2 new episodes.');
  });
});

describe('releaseEmail', () => {
  it('links one episode straight to its watch page', () => {
    const m = releaseEmail({ ...base, content: series([{ id: 'ep_4', episode: 4, name: 'Unnecessary Exposure' }]), reason: 'member' });
    expect(m.html).toContain('https://sweam.co/watch/ep_4');
    expect(m.text).toContain('Watch now: https://sweam.co/watch/ep_4');
  });

  it('lists every episode when several release together and sends the button to the title page', () => {
    const m = releaseEmail({ ...base, content: series([{ id: 'e4', episode: 4, name: 'Four' }, { id: 'e5', episode: 5, name: 'Five' }]), reason: 'member' });
    expect(m.text).toContain('- S1 E4: Four: https://sweam.co/watch/e4');
    expect(m.text).toContain('- S1 E5: Five: https://sweam.co/watch/e5');
    expect(m.text).toContain('Watch the new episodes: https://sweam.co/t/scion-saga-wloy01');
  });

  it('explains why each member got it, and marks member-wide email as promotional', () => {
    const c = series([{ id: 'e4', episode: 4, name: 'Four' }]);
    expect(releaseEmail({ ...base, content: c, reason: 'reminder' }).text).toContain('You asked Sweam to tell you when this released.');
    expect(releaseEmail({ ...base, content: c, reason: 'follower' }).text).toContain('You follow @scionsaga on Sweam.');
    const member = releaseEmail({ ...base, content: c, reason: 'member' }).text;
    expect(member).toContain('Release emails are on for your Sweam account.');
    expect(member).toContain('This is a promotional email about new releases on Sweam.');
  });

  it('carries the unsubscribe link in both parts and the company line with the postal address', () => {
    const m = releaseEmail({ ...base, content: film, reason: 'member', postalAddress: '123 Example Way, Los Angeles, CA 90001' });
    expect(m.text).toContain(base.unsubscribeUrl);
    expect(m.html).toContain(base.unsubscribeUrl.replace(/&/g, '&amp;'));
    expect(m.text).toContain('Falcyn Inc, doing business as Sweam, 123 Example Way, Los Angeles, CA 90001');
    expect(m.html).toContain('123 Example Way, Los Angeles, CA 90001');
  });

  it('sends a member without Blu access to the title page to subscribe, at the creator price', () => {
    const c = series([{ id: 'e4', episode: 4, name: 'Four' }], { is_blu: 1, blu_price_cents: 999 });
    const locked = releaseEmail({ ...base, content: c, reason: 'member', canWatch: false });
    expect(locked.text).toContain('Subscribe to watch: https://sweam.co/t/scion-saga-wloy01');
    expect(locked.text).toContain('Sweam Blu: for subscribers, $9.99 a month.');
    const open = releaseEmail({ ...base, content: c, reason: 'member', canWatch: true });
    expect(open.text).toContain('Watch now: https://sweam.co/watch/e4');
    expect(open.text).toContain('Sweam Blu: included with your subscription.');
  });

  it('uses a wide hero at full width and a tall cover at a fixed width, with alt text', () => {
    const wide = releaseEmail({ ...base, content: film, reason: 'member' }).html;
    expect(wide).toContain('src="https://sweam.co/media/u/x/y/spring-wide.jpg"');
    expect(wide).toContain('width="560"');
    expect(wide).toContain('alt="Spring cover art"');
    const tall = releaseEmail({ ...base, content: series([{ id: 'e1', episode: 1, name: 'Pilot' }]), reason: 'member' }).html;
    expect(tall).toContain('src="https://sweam.co/media/u/a/b/ep.png"');
    expect(tall).toContain('width="240"');
  });

  it('never embeds an image hosted outside Sweam', () => {
    const c = series([{ id: 'e1', episode: 1, name: 'Pilot' }], { poster_url: 'https://tracker.example.org/p.png', hero_url: 'https://tracker.example.org/h.png' });
    c.episodes[0]!.thumbnail_url = 'https://tracker.example.org/t.png';
    const m = releaseEmail({ ...base, content: c, reason: 'member' });
    expect(m.html).not.toContain('tracker.example.org');
  });

  it('escapes names in the HTML', () => {
    const c = series([{ id: 'e1', episode: 1, name: 'Pilot' }], { name: 'A <b>bold</b> show' });
    const m = releaseEmail({ ...base, content: c, reason: 'member', recipientName: 'Tom & Jerry' });
    expect(m.html).not.toContain('<b>bold</b>');
    expect(m.html).toContain('A &lt;b&gt;bold&lt;/b&gt; show');
    expect(m.html).toContain('Tom &amp; Jerry');
  });
});

describe('emailImageUrl', () => {
  it('only embeds Sweam-hosted images a mail client can load without signing in', () => {
    expect(emailImageUrl(SITE, '/media/u/a/b/poster.png')).toBe('https://sweam.co/media/u/a/b/poster.png');
    expect(emailImageUrl(SITE, 'https://cdn.example.org/x.jpg')).toBeNull();
    expect(emailImageUrl(SITE, '/media/u/a/b/clip.mp4')).toBeNull();
    expect(emailImageUrl(SITE, '/media/verify/u/id.png')).toBeNull();
    expect(emailImageUrl(SITE, '/media/u/a/b/art.svg')).toBeNull();
    expect(emailImageUrl(SITE, null)).toBeNull();
  });
});

describe('mapBatchIds', () => {
  it('lines ids up with the request when every email was accepted', () => {
    expect(mapBatchIds(3, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [])).toEqual(['a', 'b', 'c']);
  });
  it('skips rejected request indexes when Resend lists only accepted emails', () => {
    expect(mapBatchIds(4, [{ id: 'a' }, { id: 'c' }, { id: 'd' }], [1])).toEqual(['a', null, 'c', 'd']);
  });
});
