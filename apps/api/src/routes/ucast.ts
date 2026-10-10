import { Hono } from 'hono';
import type {
  UcastAuthor,
  UcastBoard,
  UcastPick,
  UcastRecast,
  UcastWorkKind,
  UcastWorkPage,
  UcastWorkSummary,
} from '@sweam/shared';
import { UCAST_WORK_KINDS } from '@sweam/shared';
import type { AppEnv } from '../env';
import { notBlockedBy } from '../lib/blocks';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify } from '../lib/notify';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { currentUser, requireUser } from '../lib/session';
import { buildRoleConsensus, duplicateRole, latestRecastableYear, ucastWorkSlug } from '../lib/ucast';
import { ucastRecastCreateSchema, ucastWorkCreateSchema } from '../lib/validate';

/**
 * UCast, the fancast room. Reading is open to everyone; opening a work,
 * posting a recast and voting need a signed-in member. Recasts are text only
 * (roles and names), carry the house disclaimer on every page, and are
 * removed only by their author or an admin. Blocks apply: a member never sees
 * the recasts of someone they blocked.
 */
export const ucastRoutes = new Hono<AppEnv>();

interface WorkRow {
  id: string;
  slug: string;
  kind: UcastWorkKind;
  title: string;
  year: number;
  hook: string;
  official: number;
  created_at: string;
  recast_count: number;
}

const WORK_SELECT = `
  SELECT w.id, w.slug, w.kind, w.title, w.year, w.hook, w.official, w.created_at,
    (SELECT COUNT(*) FROM ucast_recasts r WHERE r.work_id = w.id AND r.status = 'visible') AS recast_count
  FROM ucast_works w`;

function mapWork(row: WorkRow): UcastWorkSummary {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    year: row.year,
    hook: row.hook,
    official: row.official === 1,
    recastCount: row.recast_count,
    createdAt: row.created_at,
  };
}

async function workBySlug(db: D1Database, slug: string): Promise<WorkRow> {
  const row = await db.prepare(`${WORK_SELECT} WHERE w.slug = ?`).bind(slug).first<WorkRow>();
  if (!row) fail(404, 'work_not_found', 'No such work in UCast.');
  return row;
}

function isWorkKind(value: string | undefined): value is UcastWorkKind {
  return value !== undefined && (UCAST_WORK_KINDS as readonly string[]).includes(value);
}

/** The board: the official open calls, then every work with its recast count. */
ucastRoutes.get('/', async (c) => {
  const kind = c.req.query('kind');
  const kindFilter = isWorkKind(kind) ? ' AND w.kind = ?' : '';
  const openCallsQuery = c.env.DB.prepare(
    `${WORK_SELECT} WHERE w.official = 1${kindFilter} ORDER BY recast_count DESC, w.created_at ASC LIMIT 40`,
  );
  const worksQuery = c.env.DB.prepare(
    `${WORK_SELECT} WHERE 1 = 1${kindFilter} ORDER BY recast_count DESC, w.created_at DESC LIMIT 120`,
  );
  const [openCalls, works] = await Promise.all([
    (isWorkKind(kind) ? openCallsQuery.bind(kind) : openCallsQuery).all<WorkRow>(),
    (isWorkKind(kind) ? worksQuery.bind(kind) : worksQuery).all<WorkRow>(),
  ]);
  const body: UcastBoard = {
    openCalls: openCalls.results.map(mapWork),
    works: works.results.map(mapWork),
  };
  return c.json(body);
});

/**
 * Open a work for recasting. The slug is deterministic, so opening a work
 * someone already opened lands on the existing one (200) instead of a second
 * board (201 only when this call created it).
 */
ucastRoutes.post('/works', requireUser, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, ucastWorkCreateSchema);
  const latest = latestRecastableYear();
  if (body.year > latest) {
    fail(400, 'too_recent', `UCast is for classics: the work must be from ${latest} or earlier.`);
  }
  const slug = ucastWorkSlug(body.kind, body.title, body.year);
  const existing = await c.env.DB.prepare(`${WORK_SELECT} WHERE w.slug = ?`).bind(slug).first<WorkRow>();
  if (existing) return c.json({ work: mapWork(existing), created: false });

  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastWork, user.id);
  const id = `ucw_${crypto.randomUUID()}`;
  await c.env.DB.prepare(
    `INSERT INTO ucast_works (id, slug, kind, title, year, hook, official, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, slug, body.kind, body.title, body.year, body.hook, user.id, nowIso())
    .run();
  const work = await workBySlug(c.env.DB, slug);
  return c.json({ work: mapWork(work), created: true }, 201);
});

interface RecastRow {
  id: string;
  headline: string;
  note: string;
  created_at: string;
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
  role: string;
  original_performer: string | null;
  pick: string;
  note: string;
  votes: number;
  voted_by_me: number;
}

/** A work's page: the room's consensus per role and every visible recast with its picks. */
ucastRoutes.get('/works/:slug', async (c) => {
  const work = await workBySlug(c.env.DB, c.req.param('slug'));
  const viewer = c.get('user');
  const viewerId = viewer?.id ?? '';

  const recastRows = await c.env.DB.prepare(
    `SELECT r.id, r.headline, r.note, r.created_at, r.author_id,
       u.username AS author_username, u.display_name AS author_name, u.avatar_url AS author_avatar,
       u.verified AS author_verified, u.official AS author_official
     FROM ucast_recasts r JOIN users u ON u.id = r.author_id
     WHERE r.work_id = ?1 AND r.status = 'visible' AND ${notBlockedBy('?2', 'r.author_id')}
     ORDER BY u.official DESC, r.created_at DESC
     LIMIT 200`,
  )
    .bind(work.id, viewerId)
    .all<RecastRow>();

  const pickRows = await c.env.DB.prepare(
    `SELECT p.id, p.recast_id, p.role, p.original_performer, p.pick, p.note,
       (SELECT COUNT(*) FROM ucast_votes v WHERE v.pick_id = p.id) AS votes,
       EXISTS (SELECT 1 FROM ucast_votes v WHERE v.pick_id = p.id AND v.user_id = ?2) AS voted_by_me
     FROM ucast_picks p JOIN ucast_recasts r ON r.id = p.recast_id
     WHERE r.work_id = ?1 AND r.status = 'visible' AND ${notBlockedBy('?2', 'r.author_id')}
     ORDER BY p.recast_id, p.position`,
  )
    .bind(work.id, viewerId)
    .all<PickRow>();

  const picksByRecast = new Map<string, UcastPick[]>();
  for (const row of pickRows.results) {
    const list = picksByRecast.get(row.recast_id) ?? [];
    list.push({
      id: row.id,
      role: row.role,
      originalPerformer: row.original_performer,
      pick: row.pick,
      note: row.note,
      votes: row.votes,
      votedByMe: row.voted_by_me === 1,
    });
    picksByRecast.set(row.recast_id, list);
  }

  const recasts: UcastRecast[] = recastRows.results.map((row) => {
    const picks = picksByRecast.get(row.id) ?? [];
    const author: UcastAuthor = {
      username: row.author_username ?? '',
      displayName: row.author_name,
      avatarUrl: row.author_avatar,
      verified: row.author_verified === 1,
      official: row.author_official === 1,
    };
    return {
      id: row.id,
      headline: row.headline,
      note: row.note,
      author,
      picks,
      votes: picks.reduce((sum, p) => sum + p.votes, 0),
      isMine: viewer?.id === row.author_id,
      createdAt: row.created_at,
    };
  });

  const body: UcastWorkPage = {
    work: mapWork(work),
    roles: buildRoleConsensus(
      pickRows.results.map((p) => ({ role: p.role, pick: p.pick, votes: p.votes })),
    ),
    recasts,
  };
  return c.json(body);
});

/** Post a recast (a full cast for the work). Picks are written in one batch with the recast. */
ucastRoutes.post('/works/:slug/recasts', requireUser, async (c) => {
  const user = currentUser(c);
  const work = await workBySlug(c.env.DB, c.req.param('slug'));
  const body = await parseBody(c, ucastRecastCreateSchema);
  const repeated = duplicateRole(body.picks);
  if (repeated) {
    fail(400, 'duplicate_role', `"${repeated}" is listed twice. Name each role once per recast.`);
  }
  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastRecast, user.id);

  const recastId = `ucr_${crypto.randomUUID()}`;
  const now = nowIso();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO ucast_recasts (id, work_id, author_id, headline, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'visible', ?)`,
    ).bind(recastId, work.id, user.id, body.headline, body.note, now),
    ...body.picks.map((pick, index) =>
      c.env.DB.prepare(
        `INSERT INTO ucast_picks (id, recast_id, position, role, original_performer, pick, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `ucp_${crypto.randomUUID()}`,
        recastId,
        index + 1,
        pick.role,
        pick.originalPerformer || null,
        pick.pick,
        pick.note,
      ),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ id: recastId }, 201);
});

interface RecastContext {
  id: string;
  author_id: string;
  status: string;
  work_slug: string;
  work_title: string;
}

async function loadRecast(db: D1Database, recastId: string): Promise<RecastContext> {
  const row = await db
    .prepare(
      `SELECT r.id, r.author_id, r.status, w.slug AS work_slug, w.title AS work_title
       FROM ucast_recasts r JOIN ucast_works w ON w.id = r.work_id
       WHERE r.id = ?`,
    )
    .bind(recastId)
    .first<RecastContext>();
  if (!row) fail(404, 'recast_not_found', 'No such recast.');
  return row;
}

/** Remove a recast: its author, or an admin (who notifies the author; moderation is never silent). */
ucastRoutes.delete('/recasts/:recastId', requireUser, async (c) => {
  const user = currentUser(c);
  const recast = await loadRecast(c.env.DB, c.req.param('recastId'));
  let status: string;
  if (recast.author_id === user.id) status = 'removed_by_author';
  else if (user.isAdmin) status = 'removed_by_admin';
  else fail(404, 'recast_not_found', 'No such recast.');

  if (recast.status === 'visible') {
    await c.env.DB.prepare('UPDATE ucast_recasts SET status = ? WHERE id = ?').bind(status, recast.id).run();
    if (status === 'removed_by_admin') {
      await notify(
        c.env.DB,
        recast.author_id,
        'ucast',
        `Your UCast recast of ${recast.work_title} was removed by moderators.`,
        `/ucast/w/${recast.work_slug}`,
      );
    }
  }
  return c.json({ removed: true });
});

async function pickVotes(db: D1Database, pickId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM ucast_votes WHERE pick_id = ?')
    .bind(pickId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function visiblePick(db: D1Database, pickId: string): Promise<{ id: string }> {
  const row = await db
    .prepare(
      `SELECT p.id FROM ucast_picks p JOIN ucast_recasts r ON r.id = p.recast_id
       WHERE p.id = ? AND r.status = 'visible'`,
    )
    .bind(pickId)
    .first<{ id: string }>();
  if (!row) fail(404, 'pick_not_found', 'No such pick.');
  return row;
}

/** Agree with a pick. Idempotent. */
ucastRoutes.put('/picks/:pickId/vote', requireUser, async (c) => {
  const user = currentUser(c);
  const pick = await visiblePick(c.env.DB, c.req.param('pickId'));
  await enforceRateLimit(c.env.DB, RATE_LIMITS.ucastVote, user.id);
  await c.env.DB.prepare('INSERT OR IGNORE INTO ucast_votes (pick_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(pick.id, user.id, nowIso())
    .run();
  return c.json({ votedByMe: true, votes: await pickVotes(c.env.DB, pick.id) });
});

/** Take an agreement back. */
ucastRoutes.delete('/picks/:pickId/vote', requireUser, async (c) => {
  const user = currentUser(c);
  const pick = await visiblePick(c.env.DB, c.req.param('pickId'));
  await c.env.DB.prepare('DELETE FROM ucast_votes WHERE pick_id = ? AND user_id = ?').bind(pick.id, user.id).run();
  return c.json({ votedByMe: false, votes: await pickVotes(c.env.DB, pick.id) });
});

/** The signed-in member's own recasts, newest first. */
ucastRoutes.get('/me', requireUser, async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.headline, r.created_at, w.slug AS work_slug, w.title AS work_title, w.year AS work_year,
       (SELECT COUNT(*) FROM ucast_picks p WHERE p.recast_id = r.id) AS picks,
       (SELECT COUNT(*) FROM ucast_votes v JOIN ucast_picks p ON p.id = v.pick_id WHERE p.recast_id = r.id) AS votes
     FROM ucast_recasts r JOIN ucast_works w ON w.id = r.work_id
     WHERE r.author_id = ? AND r.status = 'visible'
     ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<{
      id: string;
      headline: string;
      created_at: string;
      work_slug: string;
      work_title: string;
      work_year: number;
      picks: number;
      votes: number;
    }>();
  return c.json({
    recasts: rows.results.map((r) => ({
      id: r.id,
      headline: r.headline,
      createdAt: r.created_at,
      work: { slug: r.work_slug, title: r.work_title, year: r.work_year },
      picks: r.picks,
      votes: r.votes,
    })),
  });
});
