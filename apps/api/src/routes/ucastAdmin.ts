import { Hono } from 'hono';
import type { AdminUcastPoll, UcastAuthor } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify } from '../lib/notify';
import { requireAdmin, currentUser } from '../lib/session';
import { latestRecastableYear, ucastWorkSlug } from '../lib/ucast';
import {
  adminUcastCreateSchema,
  adminUcastDecideSchema,
  adminUcastResultsSchema,
  adminUcastUpdateSchema,
} from '../lib/validate';
import { mapPoll, rolesFor } from './ucast';
import type { WorkRow } from './ucast';

/**
 * The UCast admin console: review requests (open with roles, a window and a
 * cover, or reject with a note), tend open polls (window, cover, roles, close
 * now), post results, open a poll directly as @ucast, and upload covers.
 * Every decision that touches a member's request notifies them.
 */
export const ucastAdminRoutes = new Hono<AppEnv>();
ucastAdminRoutes.use('*', requireAdmin);

interface AdminRow extends WorkRow {
  requester_username: string | null;
  requester_name: string;
  requester_avatar: string | null;
  requester_verified: number;
  requester_official: number;
}

const ADMIN_SELECT = `
  SELECT w.*,
    (SELECT COUNT(*) FROM ucast_roles ro WHERE ro.work_id = w.id) AS role_count,
    (SELECT COUNT(*) FROM ucast_recasts r WHERE r.work_id = w.id AND r.status = 'visible') AS ballot_count,
    u.username AS requester_username, u.display_name AS requester_name, u.avatar_url AS requester_avatar,
    u.verified AS requester_verified, u.official AS requester_official
  FROM ucast_works w JOIN users u ON u.id = w.requested_by`;

async function toAdminPoll(db: D1Database, row: AdminRow): Promise<AdminUcastPoll> {
  const requester: UcastAuthor = {
    username: row.requester_username ?? '',
    displayName: row.requester_name,
    avatarUrl: row.requester_avatar,
    verified: row.requester_verified === 1,
    official: row.requester_official === 1,
  };
  return {
    ...mapPoll(row),
    status: row.status,
    requester,
    requesterNote: row.requester_note,
    dedupeNote: row.dedupe_note,
    adminNote: row.admin_note,
    resultsNote: row.results_note,
    resultsAt: row.results_at,
    roles: await rolesFor(db, row.id),
  };
}

async function adminWork(db: D1Database, id: string): Promise<AdminRow> {
  const row = await db.prepare(`${ADMIN_SELECT} WHERE w.id = ?`).bind(id).first<AdminRow>();
  if (!row) fail(404, 'poll_not_found', 'No such poll.');
  return row;
}

/** Everything, pending requests first, then by closing date. */
ucastAdminRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `${ADMIN_SELECT} ORDER BY (w.status = 'pending') DESC, w.closes_at DESC, w.created_at DESC LIMIT 500`,
  ).all<AdminRow>();
  const polls = await Promise.all(rows.results.map((r) => toAdminPoll(c.env.DB, r)));
  return c.json({ polls });
});

async function replaceRoles(
  db: D1Database,
  workId: string,
  roles: { name: string; originalPerformer: string }[],
): Promise<D1PreparedStatement[]> {
  // Keep existing role ids where the name matches, so ballots already cast
  // (on an open poll being edited) are not orphaned.
  const current = await rolesFor(db, workId);
  const byName = new Map(current.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const keep = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  roles.forEach((role, index) => {
    const id = byName.get(role.name.trim().toLowerCase()) ?? `ucrl_${crypto.randomUUID()}`;
    keep.add(id);
    statements.push(
      db
        .prepare(
          `INSERT INTO ucast_roles (id, work_id, position, name, original_performer) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET position = ?3, name = ?4, original_performer = ?5`,
        )
        .bind(id, workId, index + 1, role.name, role.originalPerformer),
    );
  });
  for (const role of current) {
    if (!keep.has(role.id)) statements.push(db.prepare('DELETE FROM ucast_roles WHERE id = ?').bind(role.id));
  }
  return statements;
}

/** Decide a request: open it (roles, window, cover) or reject it. */
ucastAdminRoutes.post('/:id/decide', async (c) => {
  const work = await adminWork(c.env.DB, c.req.param('id'));
  if (work.status !== 'pending') fail(409, 'already_decided', 'This request has already been decided.');
  const body = await parseBody(c, adminUcastDecideSchema);
  const now = nowIso();
  const link = `/ucast/p/${work.slug}`;
  if (!body.approve) {
    await c.env.DB.prepare("UPDATE ucast_works SET status = 'rejected', admin_note = ?, decided_at = ? WHERE id = ?")
      .bind(body.adminNote, now, work.id)
      .run();
    await notify(
      c.env.DB,
      work.requested_by,
      'ucast',
      `Your UCast request for ${work.title} (${work.year}) was not opened.${body.adminNote ? ` ${body.adminNote}` : ''}`,
      '/ucast/request',
    );
    return c.json({ status: 'rejected' });
  }
  const opensAt = body.opensAt ?? now;
  if (body.closesAt <= opensAt) fail(400, 'bad_window', 'The poll must close after it opens.');
  const statements = [
    c.env.DB.prepare(
      `UPDATE ucast_works SET status = 'open', opens_at = ?1, closes_at = ?2, hook = COALESCE(?3, hook),
         cover_url = CASE WHEN ?4 = 1 THEN ?5 ELSE cover_url END, admin_note = ?6, decided_at = ?7 WHERE id = ?8`,
    ).bind(opensAt, body.closesAt, body.hook ?? null, body.coverUrl === undefined ? 0 : 1, body.coverUrl ?? null, body.adminNote, now, work.id),
    ...(await replaceRoles(c.env.DB, work.id, body.roles)),
  ];
  await c.env.DB.batch(statements);
  await notify(
    c.env.DB,
    work.requested_by,
    'ucast',
    `Your UCast request for ${work.title} (${work.year}) is now open for casting.`,
    link,
  );
  return c.json({ status: 'open' });
});

/** Edit an open poll: window, hook, cover, roles, or close it now. */
ucastAdminRoutes.patch('/:id', async (c) => {
  const work = await adminWork(c.env.DB, c.req.param('id'));
  if (work.status === 'pending' || work.status === 'rejected') {
    fail(409, 'not_open', 'Decide the request first.');
  }
  const body = await parseBody(c, adminUcastUpdateSchema);
  const now = nowIso();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.closesAt !== undefined) {
    sets.push('closes_at = ?');
    binds.push(body.closesAt);
  }
  if (body.opensAt !== undefined) {
    sets.push('opens_at = ?');
    binds.push(body.opensAt);
  }
  if (body.hook !== undefined) {
    sets.push('hook = ?');
    binds.push(body.hook);
  }
  if (body.coverUrl !== undefined) {
    sets.push('cover_url = ?');
    binds.push(body.coverUrl);
  }
  if (body.adminNote !== undefined) {
    sets.push('admin_note = ?');
    binds.push(body.adminNote);
  }
  if (body.closeNow) {
    sets.push("status = 'closed', closes_at = ?");
    binds.push(now);
  }
  const statements: D1PreparedStatement[] = [];
  if (sets.length > 0) {
    statements.push(c.env.DB.prepare(`UPDATE ucast_works SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, work.id));
  }
  if (body.roles) statements.push(...(await replaceRoles(c.env.DB, work.id, body.roles)));
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ poll: await toAdminPoll(c.env.DB, await adminWork(c.env.DB, work.id)) });
});

/** Post the results of a closed poll: they become public now, with a note. */
ucastAdminRoutes.post('/:id/results', async (c) => {
  const work = await adminWork(c.env.DB, c.req.param('id'));
  const body = await parseBody(c, adminUcastResultsSchema);
  const now = nowIso();
  const closed = work.status === 'closed' || (work.closes_at !== null && work.closes_at <= now);
  if (!closed) fail(409, 'still_open', 'Close the poll before posting results.');
  await c.env.DB.prepare("UPDATE ucast_works SET status = 'closed', results_at = ?, results_note = ? WHERE id = ?")
    .bind(now, body.resultsNote, work.id)
    .run();
  if (work.official === 0) {
    await notify(c.env.DB, work.requested_by, 'ucast', `Results are posted for your UCast poll ${work.title} (${work.year}).`, `/ucast/p/${work.slug}`);
  }
  return c.json({ status: 'closed', resultsAt: now });
});

/** Open a poll directly, as @ucast (the default) or as the admin's own account. */
ucastAdminRoutes.post('/', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, adminUcastCreateSchema);
  if (body.year > latestRecastableYear()) fail(400, 'too_recent', 'UCast is for classics (five years or older).');
  const slug = ucastWorkSlug(body.kind, body.title, body.year);
  const now = nowIso();
  const opensAt = body.opensAt ?? now;
  if (body.closesAt <= opensAt) fail(400, 'bad_window', 'The poll must close after it opens.');
  const host = body.asHost
    ? await c.env.DB.prepare("SELECT id FROM users WHERE username = 'ucast'").first<{ id: string }>()
    : null;
  const id = `ucw_${crypto.randomUUID()}`;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO ucast_works (id, slug, kind, title, year, hook, cover_url, status, official, requested_by, opens_at, closes_at, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      ).bind(id, slug, body.kind, body.title, body.year, body.hook, body.coverUrl ?? null, host ? 1 : 0, host?.id ?? admin.id, opensAt, body.closesAt, now, now),
      ...body.roles.map((role, index) =>
        c.env.DB.prepare('INSERT INTO ucast_roles (id, work_id, position, name, original_performer) VALUES (?, ?, ?, ?, ?)').bind(
          `ucrl_${crypto.randomUUID()}`,
          id,
          index + 1,
          role.name,
          role.originalPerformer,
        ),
      ),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) fail(409, 'duplicate_poll', 'That work is already in UCast.');
    throw err;
  }
  return c.json({ id, slug }, 201);
});

/**
 * Delete a poll completely, in any state: the work, its roles, every ballot,
 * pick and Agree vote, and its uploaded cover. There is no undo. Children are
 * removed explicitly (not left to cascades) so the result never depends on the
 * database's foreign-key setting.
 */
ucastAdminRoutes.delete('/:id', async (c) => {
  const work = await c.env.DB.prepare('SELECT id, title, year, cover_url FROM ucast_works WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; title: string; year: number; cover_url: string | null }>();
  if (!work) fail(404, 'poll_not_found', 'No such poll.');

  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM ucast_recasts WHERE work_id = ?1) AS ballots,
            (SELECT COUNT(*) FROM ucast_roles WHERE work_id = ?1) AS roles`,
  )
    .bind(work.id)
    .first<{ ballots: number; roles: number }>();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM ucast_votes WHERE pick_id IN (
         SELECT p.id FROM ucast_picks p JOIN ucast_recasts r ON r.id = p.recast_id WHERE r.work_id = ?)`,
    ).bind(work.id),
    c.env.DB.prepare(
      'DELETE FROM ucast_picks WHERE recast_id IN (SELECT id FROM ucast_recasts WHERE work_id = ?)',
    ).bind(work.id),
    c.env.DB.prepare('DELETE FROM ucast_recasts WHERE work_id = ?').bind(work.id),
    c.env.DB.prepare('DELETE FROM ucast_roles WHERE work_id = ?').bind(work.id),
    c.env.DB.prepare('DELETE FROM ucast_works WHERE id = ?').bind(work.id),
  ]);

  // Remove the uploaded cover too, unless another poll still points at it.
  const prefix = '/media/ucast/covers/';
  if (work.cover_url && work.cover_url.startsWith(prefix)) {
    const shared = await c.env.DB.prepare('SELECT 1 AS x FROM ucast_works WHERE cover_url = ? LIMIT 1')
      .bind(work.cover_url)
      .first();
    if (!shared) await c.env.MEDIA.delete(work.cover_url.slice('/media/'.length)).catch(() => undefined);
  }

  return c.json({ deleted: true, title: work.title, year: work.year, ballots: counts?.ballots ?? 0, roles: counts?.roles ?? 0 });
});

const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const COVER_MAX_BYTES = 8 * 1024 * 1024;

/** Upload a poll cover (JPEG, PNG or WebP, 8 MB). Returns the /media URL to store on the poll. */
ucastAdminRoutes.put('/cover/:filename', async (c) => {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim() ?? '';
  const ext = COVER_TYPES[contentType];
  if (!ext) fail(415, 'unsupported_type', 'Covers must be JPEG, PNG or WebP.');
  const length = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(length) || length <= 0) fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  if (length > COVER_MAX_BYTES) fail(413, 'too_large', 'Covers are limited to 8 MB.');
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');
  const key = `ucast/covers/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});
