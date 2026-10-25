import { describe, expect, it } from 'vitest';
import { releaseEmail } from '../src/lib/release';

const base = {
  site: 'https://sweam.co',
  titleName: 'Scion Saga',
  season: 1,
  episode: 4,
  episodeName: 'Unnecessary Exposure',
  episodeId: 'ep_4',
  creatorHandle: 'scionsaga',
  recipientName: 'Calix',
  unsubscribeUrl: 'https://sweam.co/api/email/unsubscribe?u=usr_1&t=abc',
};

describe('releaseEmail', () => {
  it('names the episode and links straight to it', () => {
    const m = releaseEmail({ ...base, reminded: true });
    expect(m.subject).toBe('Out now: Scion Saga, S1 E4: Unnecessary Exposure');
    expect(m.html).toContain('https://sweam.co/watch/ep_4');
    expect(m.text).toContain('Watch it: https://sweam.co/watch/ep_4');
  });

  it('says why the email came and carries the unsubscribe link in both parts', () => {
    const reminded = releaseEmail({ ...base, reminded: true });
    expect(reminded.text).toContain('You asked to be notified when this episode released.');
    const follower = releaseEmail({ ...base, reminded: false });
    expect(follower.text).toContain('You follow @scionsaga on Sweam.');
    for (const m of [reminded, follower]) {
      expect(m.text).toContain(base.unsubscribeUrl);
      expect(m.html).toContain(base.unsubscribeUrl.replace(/&/g, '&amp;'));
    }
  });

  it('escapes names in the HTML', () => {
    const m = releaseEmail({ ...base, reminded: false, titleName: 'A <b>bold</b> show', recipientName: 'Tom & Jerry' });
    expect(m.html).not.toContain('<b>bold</b>');
    expect(m.html).toContain('A &lt;b&gt;bold&lt;/b&gt; show');
    expect(m.html).toContain('Tom &amp; Jerry');
  });
});
