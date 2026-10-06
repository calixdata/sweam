import { describe, expect, it } from 'vitest';
import {
  creatorProfileSchema,
  episodeCreateSchema,
  progressSchema,
  reportCreateSchema,
  reportResolveSchema,
  scoutApplySchema,
  signUpSchema,
  titleCreateSchema,
  titleUpdateSchema,
} from '../src/lib/validate';

describe('signUpSchema', () => {
  it('normalizes email casing and whitespace', () => {
    const parsed = signUpSchema.parse({
      email: '  Casey@Example.COM ',
      displayName: 'Casey',
      password: 'longenough',
      username: 'CaseyP',
      ageConfirmed: true,
    });
    expect(parsed.email).toBe('casey@example.com');
    expect(parsed.username).toBe('caseyp');
  });

  it('rejects short passwords and empty names', () => {
    const base = { email: 'a@b.co', username: 'validname', ageConfirmed: true as const };
    expect(signUpSchema.safeParse({ ...base, displayName: 'A', password: 'short' }).success).toBe(false);
    expect(
      signUpSchema.safeParse({ ...base, displayName: '   ', password: 'longenough' }).success,
    ).toBe(false);
  });

  it('requires a valid username and age confirmation', () => {
    const base = { email: 'a@b.co', displayName: 'A', password: 'longenough' };
    expect(signUpSchema.safeParse({ ...base, username: 'no', ageConfirmed: true }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, username: 'valid_name', ageConfirmed: false }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, username: 'valid_name', ageConfirmed: true }).success).toBe(true);
  });
});

describe('creatorProfileSchema', () => {
  it('lowercases handles before validating', () => {
    expect(creatorProfileSchema.parse({ handle: 'NovaReyes' }).handle).toBe('novareyes');
  });

  it('rejects handles with spaces, symbols, or bad lengths', () => {
    for (const handle of ['no', 'has space', 'sem;colon', 'x'.repeat(25), 'émoji']) {
      expect(creatorProfileSchema.safeParse({ handle }).success).toBe(false);
    }
  });
});

describe('titleCreateSchema', () => {
  it('accepts a minimal valid title and applies defaults', () => {
    const parsed = titleCreateSchema.parse({
      name: 'My Film',
      kind: 'film',
      genre: 'Drama',
      posterUrl: '/media/u/abc/def/cover.png',
    });
    expect(parsed.advisory).toBe('TV-PG');
    expect(parsed.synopsis).toBe('');
    expect(parsed.posterUrl).toBe('/media/u/abc/def/cover.png');
  });

  it('requires cover art', () => {
    const missing = titleCreateSchema.safeParse({ name: 'My Film', kind: 'film', genre: 'Drama' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.message).toBe('Cover art is required.');
    expect(
      titleCreateSchema.safeParse({ name: 'X', kind: 'film', genre: 'Drama', posterUrl: null }).success,
    ).toBe(false);
    expect(
      titleCreateSchema.safeParse({ name: 'X', kind: 'film', genre: 'Drama', posterUrl: '' }).success,
    ).toBe(false);
  });

  it('rejects unknown kinds and genres', () => {
    const cover = '/media/u/abc/def/cover.png';
    expect(
      titleCreateSchema.safeParse({ name: 'X', kind: 'podcast', genre: 'Drama', posterUrl: cover }).success,
    ).toBe(false);
    expect(
      titleCreateSchema.safeParse({ name: 'X', kind: 'film', genre: 'Cooking', posterUrl: cover }).success,
    ).toBe(false);
  });
});

describe('episodeCreateSchema', () => {
  const thumbnailUrl = '/media/u/abc/def/cover.png';

  it('accepts https URLs and Sweam /media/ paths for video', () => {
    expect(
      episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: 'https://cdn.example.com/v.mp4', thumbnailUrl })
        .success,
    ).toBe(true);
    expect(
      episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: '/media/u/abc/def/v.mp4', thumbnailUrl }).success,
    ).toBe(true);
  });

  it('requires episode cover art', () => {
    const missing = episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: '/media/u/abc/def/v.mp4' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.message).toBe('Cover art is required.');
    expect(
      episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: '/media/u/abc/def/v.mp4', thumbnailUrl: null })
        .success,
    ).toBe(false);
  });

  it('rejects javascript:, relative, and empty video URLs', () => {
    for (const videoUrl of ['javascript:alert(1)', 'v.mp4', '', 'ftp://x/y.mp4', '/etc/passwd']) {
      expect(episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl, thumbnailUrl }).success).toBe(false);
    }
  });

  it('bounds season and episode numbers', () => {
    const base = { name: 'Pilot', videoUrl: 'https://cdn.example.com/v.mp4', thumbnailUrl };
    expect(episodeCreateSchema.safeParse({ ...base, season: 0 }).success).toBe(false);
    expect(episodeCreateSchema.safeParse({ ...base, episode: 501 }).success).toBe(false);
    expect(episodeCreateSchema.safeParse({ ...base, season: 1, episode: 1 }).success).toBe(true);
  });
});

describe('titleUpdateSchema', () => {
  it('accepts a scoutable-only update', () => {
    const parsed = titleUpdateSchema.safeParse({ scoutable: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scoutable).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(titleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('scoutApplySchema', () => {
  const valid = {
    firstName: 'Riley',
    lastName: 'Okafor',
    orgName: 'Northlight Studios',
    position: 'Head of Acquisitions',
    workEmail: 'Riley@Northlight.example',
    termsAccepted: true,
  };

  it('accepts a full application and normalizes the work email', () => {
    const parsed = scoutApplySchema.parse(valid);
    expect(parsed.workEmail).toBe('riley@northlight.example');
  });

  it('rejects free email providers, whatever the casing', () => {
    for (const workEmail of ['a@gmail.com', 'b@yahoo.com', 'c@Outlook.com', 'd@iCloud.com', 'e@proton.me']) {
      expect(scoutApplySchema.safeParse({ ...valid, workEmail }).success).toBe(false);
    }
  });

  it('requires the Scout Program terms to be accepted', () => {
    expect(scoutApplySchema.safeParse({ ...valid, termsAccepted: false }).success).toBe(false);
    const withoutTerms: Record<string, unknown> = { ...valid };
    delete withoutTerms.termsAccepted;
    expect(scoutApplySchema.safeParse(withoutTerms).success).toBe(false);
  });

  it('requires a name, an organization, and a position', () => {
    expect(scoutApplySchema.safeParse({ ...valid, firstName: '' }).success).toBe(false);
    expect(scoutApplySchema.safeParse({ ...valid, lastName: '  ' }).success).toBe(false);
    expect(scoutApplySchema.safeParse({ ...valid, orgName: 'X' }).success).toBe(false);
    expect(scoutApplySchema.safeParse({ ...valid, position: '' }).success).toBe(false);
  });
});

describe('reportCreateSchema', () => {
  it('accepts a report with a known reason and defaults the note', () => {
    const parsed = reportCreateSchema.parse({ titleId: 'ttl_x', reason: 'copyright' });
    expect(parsed.note).toBe('');
  });

  it('rejects unknown reasons', () => {
    expect(reportCreateSchema.safeParse({ titleId: 'ttl_x', reason: 'ugly' }).success).toBe(false);
  });
});

describe('reportResolveSchema', () => {
  it('requires a takedown kind for takedown actions', () => {
    expect(reportResolveSchema.safeParse({ action: 'takedown' }).success).toBe(false);
    expect(reportResolveSchema.safeParse({ action: 'takedown_and_strike' }).success).toBe(false);
    expect(reportResolveSchema.safeParse({ action: 'takedown', kind: 'dmca' }).success).toBe(true);
  });

  it('allows dismiss and strike without a kind', () => {
    expect(reportResolveSchema.safeParse({ action: 'dismiss' }).success).toBe(true);
    expect(reportResolveSchema.safeParse({ action: 'strike' }).success).toBe(true);
  });
});

describe('submissionCreateSchema', () => {
  const valid = {
    titleName: 'Midnight Frequencies',
    kind: 'documentary',
    audiences: ['Adult'],
    genres: ['Documentary'],
    subgenres: [],
    rating: 'PG-13',
    synopsis: 'A 40-minute documentary about pirate radio operators broadcasting after dark.',
    posterUrl: 'https://example.com/poster/midnight.jpg',
    workUrl: 'https://example.com/screener/midnight',
    rightsConfirmed: true,
  };

  it('accepts a complete submission', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    expect(submissionCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a rating and cover art', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    const noRating: Record<string, unknown> = { ...valid };
    delete noRating.rating;
    const noPoster: Record<string, unknown> = { ...valid };
    delete noPoster.posterUrl;
    expect(submissionCreateSchema.safeParse(noRating).success).toBe(false);
    expect(submissionCreateSchema.safeParse(noPoster).success).toBe(false);
  });

  it('requires the rights confirmation to be literally true', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    expect(submissionCreateSchema.safeParse({ ...valid, rightsConfirmed: false }).success).toBe(false);
  });

  it('requires an https screener link and a substantive synopsis', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    expect(submissionCreateSchema.safeParse({ ...valid, workUrl: 'http://example.com/x' }).success).toBe(false);
    expect(submissionCreateSchema.safeParse({ ...valid, synopsis: 'Short.' }).success).toBe(false);
  });

  it('requires at least one audience and genre', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    expect(submissionCreateSchema.safeParse({ ...valid, audiences: [] }).success).toBe(false);
    expect(submissionCreateSchema.safeParse({ ...valid, genres: [] }).success).toBe(false);
  });

  it('requires proof, id, and attestation when adapting a published work', async () => {
    const { submissionCreateSchema } = await import('../src/lib/validate');
    const adaptation = {
      ...valid,
      isAdaptation: true,
      adaptationSource: 'The Great Novel',
    };
    // Missing proof/id/attestation must fail.
    expect(submissionCreateSchema.safeParse(adaptation).success).toBe(false);
    // Complete adaptation passes.
    expect(
      submissionCreateSchema.safeParse({
        ...adaptation,
        rightsProofUrl: 'https://example.com/rights.pdf',
        idProofUrl: 'https://example.com/id.jpg',
        adaptationAttested: true,
      }).success,
    ).toBe(true);
  });
});

describe('community schemas', () => {
  it('accepts a comment and defaults parentId to null', async () => {
    const { commentCreateSchema } = await import('../src/lib/validate');
    const parsed = commentCreateSchema.parse({ body: '  Loved the ending.  ' });
    expect(parsed.body).toBe('Loved the ending.');
    expect(parsed.parentId).toBeNull();
  });

  it('rejects empty and oversized comment bodies', async () => {
    const { commentCreateSchema } = await import('../src/lib/validate');
    expect(commentCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(commentCreateSchema.safeParse({ body: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('restricts comment report reasons to the published set', async () => {
    const { commentReportSchema } = await import('../src/lib/validate');
    expect(commentReportSchema.safeParse({ reason: 'spam' }).success).toBe(true);
    expect(commentReportSchema.safeParse({ reason: 'copyright' }).success).toBe(false);
  });
});

describe('progressSchema', () => {
  it('accepts a normal beacon and rejects nonsense', () => {
    expect(progressSchema.safeParse({ positionS: 120, durationS: 596 }).success).toBe(true);
    expect(progressSchema.safeParse({ positionS: -1, durationS: 596 }).success).toBe(false);
    expect(progressSchema.safeParse({ positionS: 10, durationS: 0 }).success).toBe(false);
  });
});
