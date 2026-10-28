import { describe, expect, it } from 'vitest';
import type { PmbEvent, Person } from '../src/lib/pmbSync';
import { SOURCES, eventId, splitByAudience, teamIdsFrom, webVisitEvents } from '../src/lib/pmbSync';

const UUID_A = 'c398c577-a7ec-4956-8b0a-c945823f0f0d';
const UUID_B = '3d351a04-ae69-4616-94ed-bf3c87c47085';
const src = (name: string) => {
  const found = SOURCES.find((x) => x.name === name);
  if (!found) throw new Error(`no source ${name}`);
  return found;
};

describe('PM Bestie sync: event shapes', () => {
  it('keeps every id within 80 characters, even with two uuids', () => {
    expect(eventId('vs', UUID_A, UUID_B).length).toBeLessThanOrEqual(80);
    const evs = src('watching').events({ uid: UUID_A, ts: '2026-10-27T04:00:00.000Z', episode_id: UUID_B, title_id: 't1', name: 'Scion Saga', completed: 1, duration_s: 1500 });
    for (const e of evs) expect(e.id.length).toBeLessThanOrEqual(80);
  });

  it('counts video_finished only for titles 10 minutes or longer', () => {
    const long = src('watching').events({ uid: 'u1', ts: 't', episode_id: 'e1', title_id: 't1', name: 'X', completed: 1, duration_s: 600 });
    const short = src('watching').events({ uid: 'u1', ts: 't', episode_id: 'e2', title_id: 't1', name: 'X', completed: 1, duration_s: 599 });
    const unfinished = src('watching').events({ uid: 'u1', ts: 't', episode_id: 'e3', title_id: 't1', name: 'X', completed: 0, duration_s: 1200 });
    expect(long.map((e) => e.event)).toEqual(['video_started', 'video_completed', 'video_finished']);
    expect(short.map((e) => e.event)).toEqual(['video_started', 'video_completed']);
    expect(unfinished.map((e) => e.event)).toEqual(['video_started']);
  });

  it('gives a progress row the same ids every time it is read', () => {
    const row = { uid: 'u1', ts: '2026-10-01T00:00:00.000Z', episode_id: 'e1', title_id: 't1', name: 'X', completed: 1, duration_s: 900 };
    const later = { ...row, ts: '2026-10-02T00:00:00.000Z' };
    expect(src('watching').events(row).map((e) => e.id)).toEqual(src('watching').events(later).map((e) => e.id));
  });

  it('names follows, comments, replies and likes as interaction_made with a type', () => {
    expect(src('follows').events({ uid: 'u1', ts: 't', creator_id: 'c1' })[0]!).toMatchObject({ event: 'interaction_made', properties: { interaction_type: 'follow' } });
    expect(src('comments').events({ id: 'm1', uid: 'u1', ts: 't', title_id: 't1', parent_id: null })[0]!.properties.interaction_type).toBe('comment');
    expect(src('comments').events({ id: 'm2', uid: 'u1', ts: 't', title_id: 't1', parent_id: 'm1' })[0]!.properties.interaction_type).toBe('reply');
    expect(src('likes').events({ uid: 'u1', ts: 't', title_id: 't1' })[0]!.properties.interaction_type).toBe('like');
  });

  it('marks a clip apart from an episode', () => {
    expect(src('episodes').events({ id: 'e1', uid: 'u1', ts: 't', title_id: 't1', name: 'X', is_clip: 1, media_type: 'video', duration_s: 30 })[0]!.event).toBe('clip_created');
    expect(src('episodes').events({ id: 'e2', uid: 'u1', ts: 't', title_id: 't1', name: 'X', is_clip: 0, media_type: 'video', duration_s: 1300 })[0]!.event).toBe('episode_added');
  });

  it('records a scout decision as approved or declined with hours to decide', () => {
    const [ok] = src('scout_decisions').events({ uid: 's1', ts: '2026-10-02T12:00:00.000Z', created_at: '2026-10-01T12:00:00.000Z', status: 'approved' });
    const [no] = src('scout_decisions').events({ uid: 's2', ts: '2026-10-02T12:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z', status: 'declined' });
    expect(ok).toMatchObject({ event: 'scout_approved', properties: { hours_to_decision: 24 } });
    expect(no!.event).toBe('scout_declined');
  });
});

describe('PM Bestie sync: web visits', () => {
  const hit = { id: 7, ts: '2026-10-20T10:00:00.000Z', day: '2026-10-20', path: '/t/scion-saga', ref_host: '', width_bucket: 'sm', visitor_hash: 'ab'.repeat(16) };

  it('turns a hit into an anonymous visit and a page view, never a user id', () => {
    const evs = webVisitEvents(hit);
    expect(evs.map((e) => e.event)).toEqual(['site_visited', 'page_viewed']);
    for (const e of evs) {
      expect(e.user_id).toBeUndefined();
      expect(e.anonymous_id).toMatch(/^v[0-9a-f]{32}$/);
    }
    expect(evs[0]!.properties).toMatchObject({ referrer: '(direct)', landing_path: '/t/scion-saga', platform: 'web' });
  });

  it('gives every hit of one visitor on one day the same visit id', () => {
    const a = webVisitEvents(hit)[0]!.id;
    const b = webVisitEvents({ ...hit, id: 8, path: '/ucast', ts: '2026-10-20T11:00:00.000Z' })[0]!.id;
    const nextDay = webVisitEvents({ ...hit, id: 9, day: '2026-10-21' })[0]!.id;
    expect(a).toBe(b);
    expect(a).not.toBe(nextDay);
  });

  it('adds scout_landing_viewed for the Scout pages only', () => {
    expect(webVisitEvents({ ...hit, path: '/scout' }).map((e) => e.event)).toContain('scout_landing_viewed');
    expect(webVisitEvents({ ...hit, path: '/scouting-tips' }).map((e) => e.event)).not.toContain('scout_landing_viewed');
  });

  it('skips admin pages in the query itself', () => {
    expect(src('web_visits').sql).toContain(`path NOT LIKE '/admin%'`);
  });
});

describe('PM Bestie sync: who goes where', () => {
  const ev = (user_id?: string): PmbEvent => ({ id: `x${user_id}`, event: 'account_created', user_id, anonymous_id: user_id ? undefined : 'vabc', timestamp: 't', properties: {} });
  const people = new Map<string, Person>([
    ['outside', { id: 'outside', demo: 0, official: 0, admin: 0 }],
    ['seed', { id: 'seed', demo: 1, official: 0, admin: 0 }],
    ['house', { id: 'house', demo: 0, official: 1, admin: 0 }],
    ['admin', { id: 'admin', demo: 0, official: 0, admin: 1 }],
    ['listed', { id: 'listed', demo: 0, official: 0, admin: 0 }],
  ]);
  const team = teamIdsFrom(' listed, other ');

  it('sends outside people and anonymous visitors to live, the team to test, and drops demo and seed', () => {
    const out = splitByAudience([ev('outside'), ev(undefined), ev('seed'), ev('house'), ev('admin'), ev('listed'), ev('gone')], people, team);
    expect(out.live.map((e) => e.user_id ?? 'anon')).toEqual(['outside', 'anon', 'gone']);
    expect(out.test.map((e) => e.user_id)).toEqual(['house', 'admin', 'listed']);
    expect(out.dropped).toBe(1);
  });

  it('reads the team list with commas or spaces', () => {
    expect([...teamIdsFrom('a,b  c\nd')]).toEqual(['a', 'b', 'c', 'd']);
    expect(teamIdsFrom(undefined).size).toBe(0);
  });

  it('every source query reads from its cursor and is limited', () => {
    for (const x of SOURCES) {
      expect(x.sql, x.name).toContain('>= ?1');
      expect(x.sql, x.name).toContain('LIMIT ?2');
      expect(x.sql, x.name).toMatch(/AS ts\b|\bts\b/);
    }
  });
});
