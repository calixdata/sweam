import { Hono } from 'hono';
import type {
  ScoutUcastPoll,
  UcastAuthor,
  UcastBallot,
  UcastBoard,
  UcastMyRequest,
  UcastPick,
  UcastPollPage,
  UcastPollSummary,
  UcastRole,
  UcastWorkKind,
} from '@sweam/shared';
import type { AppEnv } from '../env';
import { notBlockedBy } from '../lib/blocks';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify } from '../lib/notify';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { currentUser, requireScout, requireUser } from '../lib/session';
import type { ExistingWork } from '../lib/ucast';
import { buildResults, findDuplicates, latestRecastableYear, pollPhase, resultsDueAt, ucastWorkSlug } from '../lib/ucast';
import { checkDuplicates } from '../lib/ucastAi';
import { ucastBallotSchema, ucastDuplicateCheckSchema, ucastRequestSchema } from '../lib/validate';

/**
 * UCast, the recasting polls. Reading open polls and posted results is open
 * to everyone; requesting a poll, casting a ballot and agreeing need a
 * signed-in member. Every request is de-duplicated and reviewed by an admin
 * before it opens (routes/ucastAdmin.ts). One ballot per member per poll,
 * replaced on resubmit. Scouts read every poll's full results (`/scout`).
 */
export const ucastRoutes = new Hono<AppEnv>();

export interface WorkRow {
  id: string;
  slug: string;
  kind: UcastWorkKind;
  title: string;
  year: number;
  hook: string;
  cover_url: string | null;
  status: 'pending' | 'open' | 'closed' | 'rejected';
  official: number;
  requested_by: string;
  requester_note: string;
  dedupe_note: string;
  admin_note: string;
  opens_at: string | null;
  closes_at: string | null;
  results_at: string | null;
  results_note: string;
  created_at: string;
  decided_at: string | null;
  role_count: number;
  ballot_count: number;
}

export const WORK_SELECT = `
  SELECT w.*,
    (SELECT COUNT(*) FROM ucast_roles ro WHERE ro.work_id = w.id) AS role_count,
    (SELECT COUNT(*) FROM ucast_recasts r WHERE r.work_id = w.id AND r.status = 'visible') AS ballot_count
  FROM ucast_works w`;

export function mapPoll(row: WorkRow, now = nowIso()): UcastPollSummary {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    year: row.year,
    hook: row.hook,
    coverUrl: row.cover_url,
    phase: pollPhase(row, now),
    official: row.official === 1,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    resultsDueAt: resultsDueAt(row.closes_at, row.results_at),
    roleCount: row.role_count,
    ballotCount: row.ballot_count,
    createdAt: row.created_at,
  };
}

export async function workBySlug(db: D1Database, slug: string): Promise<WorkRow> {
  const row = await db.prepare(`${WORK_SELECT} WHERE w.slug = ?`).bind(slug).first<WorkRow>();
  if (!row) fail(404, 'poll_not_found', 'No such poll in UCast.');
  return row;
}

export async function rolesFor(db: D1Database, workId: string): Promise<UcastRole[]> {
  const rows = await db
    .prepare('SELECT id, name, original_performer FROM ucast_roles WHERE work_id = ? ORDER BY position')
    .bind(workId)
    .all<{ id: string; name: string; original_performer: string }>();
  return rows.results.map((r) => ({ id: r.id, name: r.name, originalPerformer: r.original_performer }));
}

/** Every poll a member could collide with: anything not rejected. */
async function existingWorks(db: D1Database): Promise<ExistingWork[]> {
  const rows = await db
    .prepare(
      `SELECT slug, title, year, kind, status, opens_at, closes_at, results_at FROM ucast_works
       WHERE status != 'rejected' ORDER BY created_at DESC LIMIT 400`,
    )
    .all<{ slug: string; title: string; year: number; kind: UcastWorkKind } & Parameters<typeof pollPhase>[0]>();
  return rows.results.map((r) => ({ slug: r.slug, title: r.title, year: r.year, kind: r.kind, phase: pollPhase(r) }));
}

/** The board, grouped by phase so the page can be read top to bottom. */
ucastRoutes.get('/', async (c) => {
  const now = nowIso();
  const rows = await c.env.DB.prepare(
    `${WORK_SELECT} WHERE w.status IN ('open', 'closed') ORDER BY w.closes_at ASC, w.created_at ASC LIMIT 300`,
  ).all<WorkRow>();
  const polls = rows.results.map((r) => mapPoll(r, now));
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const board: UcastBoard = {
    open: polls.filter((p) => p.phase === 'open'),
    closingSoon: polls.filter((p) => p.phase === 'open' && p.closesAt !== null && p.closesAt <= soon),
    awaitingResults: polls.filter((p) => p.phase === 'closed'),
    results: polls.filter((p) => p.phase === 'results').sort((a, b) => (b.resultsDueAt ?? '').localeCompare(a.resultsDueAt ?? '')),
    scheduled: polls.filter((p) => p.phase === 'scheduled'),
  };
  return c.json(board);
});

/** Check a request for duplicates before sending it (fuzzy, plus Claude when configured). */
ucastRoutes.post('/requests/check', requireUser, async (c) => {
  const body = await parseBody(c, ucastDuplicateCheckSchema);
  const existing = await existingWorks(c.env.DB);
  return c.json(await checkDuplicates(c.env, body, existing));
});

/**
 * Request a poll. The request is checked for duplicates again here (the
 * member may skip the preview); an exact match is refused outright, a likely
 * match is refused until the member confirms it is a different work, and the
 * candidates are recorded for the admin either way. Nothing opens until an
 * admin approves it.
 */
ucastRoutes.post('/requests', requireUser, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, ucastRequestSchema);
  const latest = latestRecastableYear();
  if (body.year > latest) {
    fail(400, 'too_recent', `UCast is for classics: the work must be from ${latest} or earlier.`);
  }
  const slug = ucastWorkSlug(body.kind, body.title, body.year);
  const existing = await existingWorks(c.env.DB);
  const check = await checkDuplicates(c.env, body, existing);
  const exact = check.candidates.find((cand) => cand.slug === slug || cand.confidence >= 0.97);
  if (exact) {
    fail(409, 'duplicate_poll', `That work is already in UCast as "${exact.title} (${exact.year})".`);
  }
  const likely = check.candidates.filter((cand) => cand.confidence >= 0.5);
  if (likely.length > 0 && !body.confirmDifferent) {
    const body409 = {
      error: {
        code: 'possible_duplicate',
        message: 'This may already be in UCast. Check the matches, then confirm it is a different work.',
      },
      check,
    };
    return c.json(body409, 409);
  }
  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastRequest, user.id);

  const id = `ucw_${crypto.randomUUID()}`;
  const now = nowIso();
  const dedupeNote =
    check.candidates.length === 0
      ? `No duplicates found (${check.method}).`
      : `${check.method === 'ai' ? 'AI' : 'Fuzzy'} check flagged: ` +
        check.candidates.map((cand) => `${cand.title} (${cand.year}) ${Math.round(cand.confidence * 100)}%`).join('; ') +
        (body.confirmDifferent ? '. Member confirmed it is a different work.' : '.');
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO ucast_works
         (id, slug, kind, title, year, hook, status, official, requested_by, requester_note, dedupe_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    ).bind(id, slug, body.kind, body.title, body.year, body.hook, user.id, body.note, dedupeNote, now),
    ...body.roles.map((role, index) =>
      c.env.DB.prepare(
        'INSERT INTO ucast_roles (id, work_id, position, name, original_performer) VALUES (?, ?, ?, ?, ?)',
      ).bind(`ucrl_${crypto.randomUUID()}`, id, index + 1, role.name, role.originalPerformer),
    ),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    if (String(err).includes('UNIQUE')) fail(409, 'duplicate_poll', 'That work is already in UCast.');
    throw err;
  }
  return c.json({ id, slug, phase: 'pending' }, 201);
});

/** The member's own requests and their state. */
ucastRoutes.get('/requests/mine', requireUser, async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `${WORK_SELECT} WHERE w.requested_by = ? AND w.official = 0 ORDER BY w.created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<WorkRow>();
  const requests: UcastMyRequest[] = rows.results.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    year: r.year,
    kind: r.kind,
    phase: pollPhase(r),
    adminNote: r.admin_note,
    createdAt: r.created_at,
  }));
  return c.json({ requests });
});

interface BallotRow {
  id: string;
  note: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_username: string | null;
  author_name: string;
  author_avatar: string | null;
  author_verified: number;
  author_official: number;
}

interface PickRow {
  id: string;
  recast_id: string;
  role_id: string;
  pick: string;
  note: string;
  votes: number;
  voted_by_me: number;
}

async function loadBallots(
  db: D1Database,
  workId: string,
  viewerId: string,
): Promise<{ ballots: UcastBallot[]; pickRows: PickRow[] }> {
  const ballotRows = await db
    .prepare(
      `SELECT r.id, r.note, r.created_at, r.updated_at, r.author_id,
         u.username AS author_username, u.display_name AS author_name, u.avatar_url AS author_avatar,
         u.verified AS author_verified, u.official AS author_official
       FROM ucast_recasts r JOIN users u ON u.id = r.author_id
       WHERE r.work_id = ?1 AND r.status = 'visible' AND ${notBlockedBy('?2', 'r.author_id')}
       ORDER BY u.official DESC, r.created_at DESC
       LIMIT 500`,
    )
    .bind(workId, viewerId)
    .all<BallotRow>();
  const pickRows = await db
    .prepare(
      `SELECT p.id, p.recast_id, p.role_id, p.pick, p.note,
         (SELECT COUNT(*) FROM ucast_votes v WHERE v.pick_id = p.id) AS votes,
         EXISTS (SELECT 1 FROM ucast_votes v WHERE v.pick_id = p.id AND v.user_id = ?2) AS voted_by_me
       FROM ucast_picks p
       JOIN ucast_recasts r ON r.id = p.recast_id
       JOIN ucast_roles ro ON ro.id = p.role_id
       WHERE r.work_id = ?1 AND r.status = 'visible' AND ${notBlockedBy('?2', 'r.author_id')}
       ORDER BY p.recast_id, ro.position`,
    )
    .bind(workId, viewerId)
    .all<PickRow>();
  const picksByBallot = new Map<string, UcastPick[]>();
  for (const row of pickRows.results) {
    const list = picksByBallot.get(row.recast_id) ?? [];
    list.push({ id: row.id, roleId: row.role_id, pick: row.pick, note: row.note, votes: row.votes, votedByMe: row.voted_by_me === 1 });
    picksByBallot.set(row.recast_id, list);
  }
  const ballots: UcastBallot[] = ballotRows.results.map((row) => {
    const picks = picksByBallot.get(row.id) ?? [];
    const author: UcastAuthor = {
      username: row.author_username ?? '',
      displayName: row.author_name,
      avatarUrl: row.author_avatar,
      verified: row.author_verified === 1,
      official: row.author_official === 1,
    };
    return {
      id: row.id,
      note: row.note,
      author,
      picks,
      votes: picks.reduce((sum, p) => sum + p.votes, 0),
      isMine: viewerId !== '' && viewerId === row.author_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  return { ballots, pickRows: pickRows.results };
}

/** A poll's page. Pending and rejected requests are visible only to their requester and admins. */
ucastRoutes.get('/polls/:slug', async (c) => {
  const work = await workBySlug(c.env.DB, c.req.param('slug'));
  const viewer = c.get('user');
  const viewerId = viewer?.id ?? '';
  const phase = pollPhase(work);
  const insider = viewer !== null && (viewer.isAdmin || viewer.id === work.requested_by);
  if ((phase === 'pending' || phase === 'rejected') && !insider) {
    fail(404, 'poll_not_found', 'No such poll in UCast.');
  }
  const roles = await rolesFor(c.env.DB, work.id);
  const { ballots, pickRows } = await loadBallots(c.env.DB, work.id, viewerId);
  // Standings are live while the poll is open; once it closes they are withheld
  // until results are posted (the admin's call, or the 48-hour deadline).
  const showResults = phase === 'open' || phase === 'results' || (viewer?.isAdmin ?? false);
  const page: UcastPollPage = {
    poll: mapPoll(work),
    roles,
    results: showResults ? buildResults(roles, pickRows) : [],
    resultsNote: phase === 'results' ? work.results_note : '',
    ballots,
    myBallot: ballots.find((b) => b.isMine) ?? null,
    adminNote: insider ? work.admin_note : '',
  };
  return c.json(page);
});

/** Submit (or replace) the member's ballot for an open poll. */
ucastRoutes.put('/polls/:slug/ballot', requireUser, async (c) => {
  const user = currentUser(c);
  const work = await workBySlug(c.env.DB, c.req.param('slug'));
  if (pollPhase(work) !== 'open') fail(409, 'poll_not_open', 'This poll is not open for casting.');
  const body = await parseBody(c, ucastBallotSchema);
  const roles = await rolesFor(c.env.DB, work.id);
  const roleIds = new Set(roles.map((r) => r.id));
  const seen = new Set<string>();
  for (const pick of body.picks) {
    if (!roleIds.has(pick.roleId)) fail(400, 'unknown_role', 'One of the roles is not part of this poll.');
    if (seen.has(pick.roleId)) fail(400, 'duplicate_role', 'Each role can be cast once per ballot.');
    seen.add(pick.roleId);
  }
  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastBallot, user.id);

  const existing = await c.env.DB.prepare('SELECT id FROM ucast_recasts WHERE work_id = ? AND author_id = ?')
    .bind(work.id, user.id)
    .first<{ id: string }>();
  const ballotId = existing?.id ?? `ucr_${crypto.randomUUID()}`;
  const now = nowIso();
  const statements = existing
    ? [
        c.env.DB.prepare("UPDATE ucast_recasts SET note = ?, status = 'visible', updated_at = ? WHERE id = ?").bind(body.note, now, ballotId),
        // Replacing picks drops the agreements they had gathered; that is the
        // honest outcome of changing one's answer.
        c.env.DB.prepare('DELETE FROM ucast_picks WHERE recast_id = ?').bind(ballotId),
      ]
    : [
        c.env.DB.prepare(
          "INSERT INTO ucast_recasts (id, work_id, author_id, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'visible', ?, ?)",
        ).bind(ballotId, work.id, user.id, body.note, now, now),
      ];
  for (const pick of body.picks) {
    statements.push(
      c.env.DB.prepare('INSERT INTO ucast_picks (id, recast_id, role_id, pick, note) VALUES (?, ?, ?, ?, ?)').bind(
        `ucp_${crypto.randomUUID()}`,
        ballotId,
        pick.roleId,
        pick.pick,
        pick.note,
      ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ id: ballotId, replaced: existing !== null }, existing ? 200 : 201);
});

/** Withdraw the member's own ballot. */
ucastRoutes.delete('/polls/:slug/ballot', requireUser, async (c) => {
  const user = currentUser(c);
  const work = await workBySlug(c.env.DB, c.req.param('slug'));
  await c.env.DB.prepare("UPDATE ucast_recasts SET status = 'removed_by_author' WHERE work_id = ? AND author_id = ?")
    .bind(work.id, user.id)
    .run();
  return c.json({ removed: true });
});

/** Admin removal of any ballot; the author is told (moderation is never silent). */
ucastRoutes.delete('/ballots/:ballotId', requireUser, async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.author_id, r.status, w.slug, w.title FROM ucast_recasts r JOIN ucast_works w ON w.id = r.work_id WHERE r.id = ?`,
  )
    .bind(c.req.param('ballotId'))
    .first<{ id: string; author_id: string; status: string; slug: string; title: string }>();
  if (!row) fail(404, 'ballot_not_found', 'No such ballot.');
  const status = row.author_id === user.id ? 'removed_by_author' : user.isAdmin ? 'removed_by_admin' : null;
  if (!status) fail(404, 'ballot_not_found', 'No such ballot.');
  if (row.status === 'visible') {
    await c.env.DB.prepare('UPDATE ucast_recasts SET status = ? WHERE id = ?').bind(status, row.id).run();
    if (status === 'removed_by_admin') {
      await notify(c.env.DB, row.author_id, 'ucast', `Your UCast ballot on ${row.title} was removed by moderators.`, `/ucast/p/${row.slug}`);
    }
  }
  return c.json({ removed: true });
});

async function pickVotes(db: D1Database, pickId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM ucast_votes WHERE pick_id = ?').bind(pickId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** A pick that can still take agreements: on a visible ballot in an open poll. */
async function openPick(db: D1Database, pickId: string): Promise<{ id: string; author_id: string }> {
  const row = await db
    .prepare(
      `SELECT p.id, r.author_id, w.status, w.opens_at, w.closes_at, w.results_at
       FROM ucast_picks p JOIN ucast_recasts r ON r.id = p.recast_id JOIN ucast_works w ON w.id = r.work_id
       WHERE p.id = ? AND r.status = 'visible'`,
    )
    .bind(pickId)
    .first<{ id: string; author_id: string } & Parameters<typeof pollPhase>[0]>();
  if (!row) fail(404, 'pick_not_found', 'No such pick.');
  if (pollPhase(row) !== 'open') fail(409, 'poll_not_open', 'This poll is closed.');
  return row;
}

/** Agree with a pick. Idempotent; you cannot agree with your own. */
ucastRoutes.put('/picks/:pickId/vote', requireUser, async (c) => {
  const user = currentUser(c);
  const pick = await openPick(c.env.DB, c.req.param('pickId'));
  if (pick.author_id === user.id) fail(400, 'own_pick', 'That is your own pick.');
  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastVote, user.id);
  await c.env.DB.prepare('INSERT OR IGNORE INTO ucast_votes (pick_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(pick.id, user.id, nowIso())
    .run();
  return c.json({ votedByMe: true, votes: await pickVotes(c.env.DB, pick.id) });
});

/** Take an agreement back. */
ucastRoutes.delete('/picks/:pickId/vote', requireUser, async (c) => {
  const user = currentUser(c);
  const pick = await openPick(c.env.DB, c.req.param('pickId'));
  await c.env.DB.prepare('DELETE FROM ucast_votes WHERE pick_id = ? AND user_id = ?').bind(pick.id, user.id).run();
  return c.json({ votedByMe: false, votes: await pickVotes(c.env.DB, pick.id) });
});

// ---------------------------------------------------------------------------
// Scouts: the data. Every poll, full results, live while open, CSV on request.
// ---------------------------------------------------------------------------

ucastRoutes.get('/scout', requireScout, async (c) => {
  const now = nowIso();
  const rows = await c.env.DB.prepare(
    `${WORK_SELECT} WHERE w.status IN ('open', 'closed') ORDER BY w.closes_at DESC LIMIT 400`,
  ).all<WorkRow>();
  return c.json({ polls: rows.results.map((r) => mapPoll(r, now)) });
});

async function scoutPoll(db: D1Database, slug: string): Promise<ScoutUcastPoll> {
  const work = await workBySlug(db, slug);
  if (work.status === 'pending' || work.status === 'rejected') fail(404, 'poll_not_found', 'No such poll in UCast.');
  const roles = await rolesFor(db, work.id);
  const { ballots, pickRows } = await loadBallots(db, work.id, '');
  return {
    poll: mapPoll(work),
    results: buildResults(roles, pickRows),
    participants: ballots.length,
    totalVotes: pickRows.reduce((sum, p) => sum + p.votes, 0),
  };
}

ucastRoutes.get('/scout/:slug', requireScout, async (c) => c.json(await scoutPoll(c.env.DB, c.req.param('slug'))));

/** The same results as CSV: one row per role and performer. */
ucastRoutes.get('/scout/:slug/results.csv', requireScout, async (c) => {
  const data = await scoutPoll(c.env.DB, c.req.param('slug'));
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['poll', 'kind', 'year', 'phase', 'closes_at', 'participants', 'role', 'original_performer', 'performer', 'ballots', 'share', 'agreements'].join(','),
    ...data.results.flatMap((r) =>
      r.standings.map((s) =>
        [
          esc(data.poll.title), data.poll.kind, data.poll.year, data.poll.phase, data.poll.closesAt ?? '', data.participants,
          esc(r.role.name), esc(r.role.originalPerformer), esc(s.pick), s.ballots, s.share.toFixed(3), s.votes,
        ].join(','),
      ),
    ),
  ];
  return new Response(lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ucast-${data.poll.slug}.csv"`,
    },
  });
});

export { findDuplicates };
