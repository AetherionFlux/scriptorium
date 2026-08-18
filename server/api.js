/**
 * server/api.js — all Scriptorium endpoint handlers.
 *
 * Framework-agnostic by design: each handler receives
 *   ctx = { db, user, secret, body, query, url }
 * and returns { status, body, headers? }. The SvelteKit layer (and the bare
 * node server in index.js) are thin adapters over this file.
 *
 * Permission checks always go through permissions.can() against FRESH rows
 * from the DB — never against cached or client-supplied state.
 */
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken, csrfFor, newApiKey, newResetToken, sessionCookieOptions, COOKIE_NAME, COOKIE_TTL_DAYS } from './auth.js';
import { can, spaceRole, spaceVisibleTo } from './permissions.js';
import { renderMarkdown, katexCss, katexFontPath } from './markdown.js';
import { readFileSync } from 'node:fs';
import { ftsQuery } from './db.js';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const err = (code, message, status) => ({ status, body: { error: message, code } });
const ok = (body, extra = {}) => ({ status: 200, body, ...extra });

const slugify = (s) =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

function spaceBySlug(db, slug) {
  return db.prepare('SELECT * FROM spaces WHERE slug = ?').get(slug);
}
function spaceWithMembers(db, space) {
  const __members = db.prepare('SELECT user_id, role FROM space_members WHERE space_id = ?').all(space.id);
  return { ...space, __members };
}
function pageInSpace(db, spaceId, slug) {
  return db.prepare("SELECT * FROM pages WHERE space_id = ? AND slug = ? AND deleted_at IS NULL").get(spaceId, slug);
}
function logActivity(db, { userId, spaceId, pageId, action, detail = '' }) {
  db.prepare('INSERT INTO activity (user_id, space_id, page_id, action, detail) VALUES (?,?,?,?,?)')
    .run(userId ?? null, spaceId ?? null, pageId ?? null, action, detail);
}
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at, has_api_key: !!u.api_key };
}
function pageMeta(p) {
  return {
    slug: p.slug, title: p.title, parent_slug: null, rev: p.rev,
    created_by: p.created_by, created_at: p.created_at,
    updated_by: p.updated_by, updated_at: p.updated_at,
    content_length: (p.content ?? '').length
  };
}

/** Resolve a wiki link target: {spaceSlug, name} → page row or null. */
function makeWikiResolver(db, currentSpaceSlug) {
  return ({ spaceSlug, name }) => {
    const targetSpace = spaceBySlug(db, spaceSlug || currentSpaceSlug);
    if (!targetSpace) return { slug: null, spaceSlug: spaceSlug || null, exists: false };
    const slug = slugify(name);
    const p = pageInSpace(db, targetSpace.id, slug);
    return {
      slug: p ? p.slug : null,
      spaceSlug: targetSpace.slug,
      exists: !!p
    };
  };
}

/** Build the nested page tree for a space. */
function pageTree(db, spaceId, parentSlug = null) {
  const rows = db.prepare(
    'SELECT p.*, u.name AS updated_by_name FROM pages p LEFT JOIN users u ON u.id = p.updated_by WHERE p.space_id = ? AND p.deleted_at IS NULL ORDER BY p.title'
  ).all(spaceId);
  const byParent = new Map();
  for (const r of rows) {
    const key = r.parent_slug ?? '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  const build = (parentKey, depth) =>
    (byParent.get(parentKey) ?? []).map((r) => ({
      slug: r.slug, title: r.title, rev: r.rev, updated_at: r.updated_at,
      updated_by_name: r.updated_by_name, depth,
      children: build(r.slug, depth + 1)
    }));
  return build('__root__', 0);
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

const VALID_ROLES = ['user', 'admin'];

/** POST /api/auth/register — first registered user becomes admin. */
export async function authRegister(ctx) {
  const { email, password, name } = ctx.body ?? {};
  if (!EMAIL_RE.test(email ?? '')) return err('VALIDATION', 'A valid email is required.', 400);
  if (typeof password !== 'string' || password.length < PASSWORD_MIN)
    return err('VALIDATION', `Password must be at least ${PASSWORD_MIN} characters.`, 400);
  const displayName = (name ?? '').trim() || email.split('@')[0];

  const existing = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return err('CONFLICT', 'An account with that email already exists.', 409);

  const isAdmin = ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_seed = 0').get().n === 0;
  const hash = await hashPassword(password);
  const info = ctx.db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
    .run(email, displayName, hash, isAdmin ? 'admin' : 'user');
  logActivity(ctx.db, { userId: info.lastInsertRowid, action: 'user.register', detail: isAdmin ? 'first account (admin)' : '' });

  const token = createSessionToken(info.lastInsertRowid, ctx.secret);
  return {
    status: 201,
    body: { user: publicUser({ id: info.lastInsertRowid, email, name: displayName, role: isAdmin ? 'admin' : 'user', created_at: new Date().toISOString(), api_key: null }) },
    headers: { 'set-cookie': `${COOKIE_NAME}=${token}; ${cookieStr(sessionCookieOptions())}` }
  };
}

/** POST /api/auth/login */
export async function authLogin(ctx) {
  const { email, password } = ctx.body ?? {};
  const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email ?? '');
  if (!user || !(await verifyPassword(user.password_hash, password ?? '')))
    return err('UNAUTHENTICATED', 'Invalid email or password.', 401);
  const token = createSessionToken(user.id, ctx.secret);
  return {
    status: 200,
    body: { user: publicUser(user) },
    headers: { 'set-cookie': `${COOKIE_NAME}=${token}; ${cookieStr(sessionCookieOptions())}` }
  };
}

/** POST /api/auth/logout */
export function authLogout(ctx) {
  return {
    status: 200,
    body: { ok: true },
    headers: { 'set-cookie': `${COOKIE_NAME}=; max-age=0; path=/; httponly; samesite=lax` }
  };
}

/** GET /api/auth/me */
export function authMe(ctx) {
  if (!ctx.user) return err('UNAUTHENTICATED', 'Not signed in.', 401);
  return ok({ user: publicUser(ctx.user), csrf: ctx.csrf });
}

/** GET /api/auth/csrf — the CSRF token for the current session (client caches it). */
export function authCsrf(ctx) {
  if (!ctx.user) return err('UNAUTHENTICATED', 'Not signed in.', 401);
  return ok({ csrf: ctx.csrf });
}

/**
 * POST /api/auth/reset — create a reset token.
 * v1: the token is returned in the response (no SMTP configured). A real
 * deployment wires this to an email provider; the confirm endpoint is stable.
 */
export function authReset(ctx) {
  const { email } = ctx.body ?? {};
  const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email ?? '');
  if (!user) return ok({ ok: true, token: null }); // don't leak account existence
  const token = newResetToken();
  const expires = new Date(Date.now() + 3600e3).toISOString();
  ctx.db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?,?,?)').run(token, user.id, expires);
  return ok({ ok: true, token });
}

/** POST /api/auth/reset/confirm — consume token, set new password. */
export async function authResetConfirm(ctx) {
  const { token, password } = ctx.body ?? {};
  if (typeof password !== 'string' || password.length < PASSWORD_MIN)
    return err('VALIDATION', `Password must be at least ${PASSWORD_MIN} characters.`, 400);
  const row = ctx.db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token ?? '');
  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now())
    return err('VALIDATION', 'Reset token is invalid or expired.', 400);
  const hash = await hashPassword(password);
  ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
  ctx.db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);
  logActivity(ctx.db, { userId: row.user_id, action: 'user.register', detail: 'password reset' });
  return ok({ ok: true });
}

function cookieStr(o) {
  const parts = [];
  if (o.httpOnly) parts.push('httponly');
  if (o.sameSite) parts.push(`samesite=${o.sameSite.toLowerCase()}`);
  if (o.secure) parts.push('secure');
  parts.push(`max-age=${o.maxAge}`, `path=${o.path}`);
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// SPACES
// ---------------------------------------------------------------------------

/** GET /api/spaces */
export function listSpaces(ctx) {
  const all = ctx.db.prepare('SELECT * FROM spaces ORDER BY name').all();
  const visible = all
    .map((s) => spaceWithMembers(ctx.db, s))
    .filter((s) => spaceVisibleTo(s, ctx.user))
    .map((s) => ({
      slug: s.slug, name: s.name, description: s.description, visibility: s.visibility,
      my_role: ctx.user ? spaceRole(ctx.user.id, s) : s.visibility === 'public' ? 'public' : null
    }));
  return ok({ spaces: visible });
}

/** POST /api/spaces */
export function createSpace(ctx) {
  if (!ctx.user) return err('UNAUTHENTICATED', 'Sign in to create a space.', 401);
  const { name, slug, description, visibility } = ctx.body ?? {};
  if (!name || name.trim().length < 2) return err('VALIDATION', 'Space name must be at least 2 characters.', 400);
  const vis = visibility === 'private' ? 'private' : 'public';
  let s = slug ? slugify(slug) : slugify(name);
  if (!s) return err('VALIDATION', 'Could not derive a slug from the space name.', 400);
  // Ensure uniqueness with a numeric suffix if needed.
  const taken = (candidate) => !!spaceBySlug(ctx.db, candidate);
  let final = s, n = 2;
  while (taken(final)) final = `${s}-${n++}`;

  const info = ctx.db.prepare('INSERT INTO spaces (slug, name, description, visibility, owner_id) VALUES (?,?,?,?,?)')
    .run(final, name.trim(), (description ?? '').trim(), vis, ctx.user.id);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: info.lastInsertRowid, action: 'space.create', detail: final });
  const space = spaceWithMembers(ctx.db, ctx.db.prepare('SELECT * FROM spaces WHERE id = ?').get(info.lastInsertRowid));
  return { status: 201, body: { space: { slug: space.slug, name: space.name, description: space.description, visibility: space.visibility, my_role: 'owner' } } };
}

/** GET /api/spaces/:slug */
export function getSpace(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'space.view')) return err('FORBIDDEN', 'You do not have access to this space.', 403);
  const tree = pageTree(ctx.db, space.id);
  return ok({
    space: { slug: s.slug, name: s.name, description: s.description, visibility: s.visibility, my_role: ctx.user ? spaceRole(ctx.user.id, s) : 'public' },
    tree,
    members: ctx.user && spaceRole(ctx.user.id, s)
      ? s.__members.map((m) => {
          const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
          return { user_id: m.user_id, role: m.role, name: u?.name ?? 'deleted', email: u?.email ?? '' };
        })
      : null
  });
}

/** PATCH /api/spaces/:slug */
export function updateSpace(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'space.update')) return err('FORBIDDEN', 'Space maintainers or admin can do that.', 403);
  const { name, description, visibility } = ctx.body ?? {};
  if (name != null && name.trim().length < 2) return err('VALIDATION', 'Space name must be at least 2 characters.', 400);
  ctx.db.prepare('UPDATE spaces SET name = COALESCE(?, name), description = COALESCE(?, description), visibility = COALESCE(?, visibility) WHERE id = ?')
    .run(name?.trim() ?? null, description?.trim() ?? null, visibility === 'public' || visibility === 'private' ? visibility : null, space.id);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, action: 'space.update' });
  return getSpace(ctx);
}

/** DELETE /api/spaces/:slug */
export function deleteSpace(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'space.delete')) return err('FORBIDDEN', 'Space maintainers or admin can do that.', 403);
  ctx.db.prepare('DELETE FROM spaces WHERE id = ?').run(space.id);
  logActivity(ctx.db, { userId: ctx.user.id, action: 'space.delete', detail: space.slug });
  return ok({ ok: true });
}

// ---- members -------------------------------------------------------------

function assertMemberManager(ctx, space) {
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'members.manage'))
    return { error: err('FORBIDDEN', 'Space maintainers or admin can manage members.', 403) };
  return { s };
}

/** GET /api/spaces/:slug/members */
export function listMembers(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const { s, error } = assertMemberManager(ctx, space);
  if (error) return error;
  const rows = s.__members.map((m) => {
    const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
    return { user_id: m.user_id, role: m.role, name: u?.name ?? 'deleted', email: u?.email ?? '' };
  });
  return ok({ members: rows });
}

/** POST /api/spaces/:slug/members — {email, role} */
export function addMember(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const { s, error } = assertMemberManager(ctx, space);
  if (error) return error;
  const { email, role } = ctx.body ?? {};
  const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email ?? '');
  if (!user) return err('NOT_FOUND', `No user with email ${email ?? ''}.`, 404);
  if (!['viewer', 'editor', 'maintainer'].includes(role)) return err('VALIDATION', "Role must be viewer, editor, or maintainer.", 400);
  ctx.db.prepare('INSERT OR REPLACE INTO space_members (space_id, user_id, role) VALUES (?,?,?)').run(space.id, user.id, role);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, action: 'member.add', detail: `${user.email} → ${role}` });
  return { status: 201, body: { ok: true } };
}

/** PATCH /api/spaces/:slug/members/:userId — {role} */
export function updateMember(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const { s, error } = assertMemberManager(ctx, space);
  if (error) return error;
  const userId = Number(ctx.url.userId);
  const { role } = ctx.body ?? {};
  if (!['viewer', 'editor', 'maintainer'].includes(role)) return err('VALIDATION', "Role must be viewer, editor, or maintainer.", 400);
  if (userId === space.owner_id) return err('VALIDATION', "The space owner's role cannot be changed.", 400);
  const ex = ctx.db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(space.id, userId);
  if (!ex) return err('NOT_FOUND', 'User is not a member of this space.', 404);
  ctx.db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?').run(role, space.id, userId);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, action: 'member.update', detail: `user ${userId} → ${role}` });
  return ok({ ok: true });
}

/** DELETE /api/spaces/:slug/members/:userId */
export function removeMember(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const { s, error } = assertMemberManager(ctx, space);
  if (error) return error;
  const userId = Number(ctx.url.userId);
  if (userId === space.owner_id) return err('VALIDATION', 'The space owner cannot be removed.', 400);
  ctx.db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(space.id, userId);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, action: 'member.remove', detail: `user ${userId}` });
  return ok({ ok: true });
}

// ---------------------------------------------------------------------------
// PAGES
// ---------------------------------------------------------------------------

/** GET /api/spaces/:slug/pages — nested tree */
export function listPages(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.slug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'page.view')) return err('FORBIDDEN', 'You do not have access to this space.', 403);
  return ok({ tree: pageTree(ctx.db, space.id) });
}

function findPageForAction(ctx, slug, action) {
  const space = spaceBySlug(ctx.db, ctx.url.spaceSlug);
  if (!space) return { error: err('NOT_FOUND', 'Space not found.', 404) };
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'page.view')) return { error: err('FORBIDDEN', 'You do not have access to this space.', 403) };
  const page = pageInSpace(ctx.db, space.id, slug);
  if (!page) return { error: err('NOT_FOUND', 'Page not found.', 404) };
  if (!can({ user: ctx.user, space: s }, action, { pageAuthorId: page.created_by }))
    return { error: err('FORBIDDEN', `You need ${action.replace('page.', '')} access for this page.`, 403) };
  return { space, s, page };
}

/** GET /api/spaces/:slug/pages/:slug — meta + content */
export function getPage(ctx) {
  const { error, space, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.view');
  if (error) return error;
  const parent = page.parent_id ? ctx.db.prepare('SELECT slug FROM pages WHERE id = ?').get(page.parent_id) : null;
  return ok({
    meta: { ...pageMeta(page), parent_slug: parent?.slug ?? null, space_slug: space.slug },
    content: page.content
  });
}

/** POST /api/spaces/:slug/pages — {title, slug?, content?, parent_slug?} */
export function createPage(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.spaceSlug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'page.create')) return err('FORBIDDEN', 'You need editor access to create pages.', 403);
  const { title, slug, content, parent_slug } = ctx.body ?? {};
  if (!title || title.trim().length < 1) return err('VALIDATION', 'Title is required.', 400);
  let finalSlug = slug ? slugify(slug) : slugify(title);
  if (!finalSlug) return err('VALIDATION', 'Could not derive a slug from the title.', 400);
  if (pageInSpace(ctx.db, space.id, finalSlug)) return err('CONFLICT', `A page with slug "${finalSlug}" already exists.`, 409);

  let parentId = null;
  if (parent_slug) {
    const p = pageInSpace(ctx.db, space.id, parent_slug);
    if (!p) return err('NOT_FOUND', `Parent page "${parent_slug}" not found.`, 404);
    parentId = p.id;
  }

  const now = new Date().toISOString();
  const info = ctx.db.transaction(() => {
    const i = ctx.db.prepare('INSERT INTO pages (space_id, slug, title, content, parent_id, rev, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
      .run(space.id, finalSlug, title.trim(), content ?? '', parentId, ctx.user.id, ctx.user.id, now, now);
    const r = ctx.db.prepare('INSERT INTO page_history (page_id, rev, content, title, author_id) VALUES (?,?,?,?,?)')
      .run(i.lastInsertRowid, 1, content ?? '', title.trim(), ctx.user.id);
    return { lastInsertRowid: i.lastInsertRowid };
  })();

  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, pageId: info.lastInsertRowid, action: 'page.create', detail: finalSlug });
  const page = pageInSpace(ctx.db, space.id, finalSlug);
  return { status: 201, body: { meta: pageMeta(page) } };
}

/** PUT /api/spaces/:slug/pages/:slug — {title?, content?, parent_slug?} */
export function updatePage(ctx) {
  const { error, space, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.update');
  if (error) return error;
  const { title, content, parent_slug } = ctx.body ?? {};
  if (content == null && title == null && parent_slug === undefined)
    return err('VALIDATION', 'Nothing to update.', 400);
  if (title != null && title.trim().length < 1) return err('VALIDATION', 'Title cannot be empty.', 400);

  let parentId = page.parent_id;
  if (parent_slug !== undefined) {
    if (parent_slug === null) parentId = null;
    else {
      if (parent_slug === page.slug) return err('VALIDATION', 'A page cannot be its own parent.', 400);
      const p = pageInSpace(ctx.db, space.id, parent_slug);
      if (!p) return err('NOT_FOUND', `Parent page "${parent_slug}" not found.`, 404);
      parentId = p.id;
    }
  }

  const now = new Date().toISOString();
  const newRev = page.rev + 1;
  const newTitle = title?.trim() ?? page.title;
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE pages SET title = ?, content = COALESCE(?, content), parent_id = ?, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(newTitle, content ?? null, parentId, newRev, ctx.user.id, now, page.id);
    ctx.db.prepare('INSERT INTO page_history (page_id, rev, content, title, author_id) VALUES (?,?,?,?,?)')
      .run(page.id, newRev, content ?? page.content, newTitle, ctx.user.id);
  })();
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, pageId: page.id, action: 'page.update', detail: `rev ${newRev}` });
  const updated = pageInSpace(ctx.db, space.id, page.slug);
  return ok({ meta: pageMeta(updated) });
}

/** DELETE /api/spaces/:slug/pages/:slug (soft) */
export function deletePage(ctx) {
  const { error, space, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.delete');
  if (error) return error;
  ctx.db.prepare("UPDATE pages SET deleted_at = ?, rev = rev WHERE id = ?").run(new Date().toISOString(), page.id);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, pageId: page.id, action: 'page.delete' });
  return ok({ ok: true });
}

/** POST /api/spaces/:slug/pages/:slug/restore */
export function restorePage(ctx) {
  const space = spaceBySlug(ctx.db, ctx.url.spaceSlug);
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'page.view')) return err('FORBIDDEN', 'No access.', 403);
  const page = ctx.db.prepare('SELECT * FROM pages WHERE space_id = ? AND slug = ?').get(space.id, ctx.url.pageSlug);
  if (!page) return err('NOT_FOUND', 'Page not found.', 404);
  if (!can({ user: ctx.user, space: s }, 'page.restore')) return err('FORBIDDEN', 'Maintainers can restore pages.', 403);
  ctx.db.prepare('UPDATE pages SET deleted_at = NULL WHERE id = ?').run(page.id);
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, pageId: page.id, action: 'page.restore' });
  return ok({ ok: true });
}

/** GET /api/spaces/:slug/pages/:slug/history */
export function pageHistory(ctx) {
  const { error, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.view');
  if (error) return error;
  const rows = ctx.db.prepare(
    'SELECT h.rev, h.created_at, u.name AS author FROM page_history h LEFT JOIN users u ON u.id = h.author_id WHERE h.page_id = ? ORDER BY h.rev DESC'
  ).all(page.id);
  return ok({ history: rows });
}

/** GET /api/spaces/:slug/pages/:slug/history/:rev */
export function pageHistoryRev(ctx) {
  const { error, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.view');
  if (error) return error;
  const row = ctx.db.prepare('SELECT * FROM page_history WHERE page_id = ? AND rev = ?').get(page.id, Number(ctx.url.rev));
  if (!row) return err('NOT_FOUND', 'Revision not found.', 404);
  return ok({ rev: row.rev, title: row.title, content: row.content, created_at: row.created_at });
}

/** POST /api/spaces/:slug/pages/:slug/history/:rev/restore — editor+ */
export function restoreRevision(ctx) {
  const { error, space, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.update');
  if (error) return error;
  const row = ctx.db.prepare('SELECT * FROM page_history WHERE page_id = ? AND rev = ?').get(page.id, Number(ctx.url.rev));
  if (!row) return err('NOT_FOUND', 'Revision not found.', 404);
  const now = new Date().toISOString();
  const newRev = page.rev + 1;
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE pages SET content = ?, title = ?, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(row.content, row.title, newRev, ctx.user.id, now, page.id);
    ctx.db.prepare('INSERT INTO page_history (page_id, rev, content, title, author_id) VALUES (?,?,?,?,?)')
      .run(page.id, newRev, row.content, row.title, ctx.user.id);
  })();
  logActivity(ctx.db, { userId: ctx.user.id, spaceId: space.id, pageId: page.id, action: 'page.restore', detail: `from rev ${row.rev}` });
  const updated = pageInSpace(ctx.db, space.id, page.slug);
  return ok({ meta: pageMeta(updated) });
}

/** GET /api/spaces/:slug/pages/:slug/render — server-rendered HTML */
export function renderPage(ctx) {
  const { error, space, page } = findPageForAction(ctx, ctx.url.pageSlug, 'page.view');
  if (error) return error;
  const html = renderMarkdown(page.content, { resolveWikilink: makeWikiResolver(ctx.db, space.slug) });
  return ok({ html, rev: page.rev });
}

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------

/** GET /api/search?q=… */
export function search(ctx) {
  const q = (ctx.query.q ?? '').trim();
  if (!q) return ok({ results: [] });
  // Candidate pages from FTS, then filtered by space visibility.
  const rows = ctx.db.prepare(`
    SELECT p.id, p.space_id, p.slug, p.title, s.slug AS space_slug, s.name AS space_name,
           snippet(pages_fts, 1, '…', '…', '…', 32) AS snippet,
           bm25(pages_fts) AS rank
    FROM pages_fts
    JOIN pages p ON p.id = pages_fts.rowid
    JOIN spaces s ON s.id = p.space_id
    WHERE pages_fts MATCH ? AND p.deleted_at IS NULL
    ORDER BY rank
    LIMIT 50
  `).all(ftsQuery(q));

  const out = [];
  for (const r of rows) {
    const space = spaceWithMembers(ctx.db, ctx.db.prepare('SELECT * FROM spaces WHERE id = ?').get(r.space_id));
    if (!can({ user: ctx.user, space }, 'page.view')) continue;
    out.push({
      space_slug: r.space_slug, space_name: r.space_name,
      slug: r.slug, title: r.title, snippet: r.snippet, rank: r.rank
    });
  }
  return ok({ results: out });
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

function requireAdmin(ctx) {
  if (!ctx.user) return err('UNAUTHENTICATED', 'Sign in required.', 401);
  if (ctx.user.role !== 'admin') return err('FORBIDDEN', 'Admin access required.', 403);
  return null;
}

/** GET /api/admin/stats */
export function adminStats(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const db = ctx.db;
  const one = (sql) => db.prepare(sql).get();
  return ok({
    users: one('SELECT COUNT(*) n FROM users').n,
    spaces: one('SELECT COUNT(*) n FROM spaces').n,
    pages: one('SELECT COUNT(*) n FROM pages WHERE deleted_at IS NULL').n,
    revisions: one('SELECT COUNT(*) n FROM page_history').n,
    last_activity: one('SELECT created_at FROM activity ORDER BY id DESC LIMIT 1')?.created_at ?? null
  });
}

/** GET /api/admin/users */
export function adminUsers(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const rows = ctx.db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM space_members m WHERE m.user_id = u.id) AS memberships
    FROM users u ORDER BY u.created_at
  `).all();
  return ok({ users: rows.map(publicUser).map((u) => ({ ...u })) });
}

/** POST /api/admin/users — {email, password, name, role?} */
export async function adminCreateUser(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const { email, password, name, role } = ctx.body ?? {};
  if (!EMAIL_RE.test(email ?? '')) return err('VALIDATION', 'A valid email is required.', 400);
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return err('VALIDATION', `Password must be at least ${PASSWORD_MIN} characters.`, 400);
  if (role && !VALID_ROLES.includes(role)) return err('VALIDATION', 'Role must be user or admin.', 400);
  if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return err('CONFLICT', 'Email already in use.', 409);
  const hash = await hashPassword(password);
  const info = ctx.db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
    .run(email, (name ?? '').trim() || email.split('@')[0], hash, role ?? 'user');
  logActivity(ctx.db, { userId: ctx.user.id, action: 'user.register', detail: `created by admin: ${email}` });
  return { status: 201, body: { user: publicUser(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) } };
}

/** PATCH /api/admin/users/:id — {name?, role?, password?, api_key?} */
export async function adminUpdateUser(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const id = Number(ctx.url.userId);
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return err('NOT_FOUND', 'User not found.', 404);
  const { name, role, password, api_key } = ctx.body ?? {};
  if (role && !VALID_ROLES.includes(role)) return err('VALIDATION', 'Role must be user or admin.', 400);
  if (id === ctx.user.id && role === 'user') return err('VALIDATION', 'You cannot demote yourself.', 400);
  if (api_key === '' && u.api_key) {
    ctx.db.prepare('UPDATE users SET api_key = NULL WHERE id = ?').run(id);
  } else if (api_key === true || api_key === undefined) {
    // 'true' → (re)generate
    if (api_key === true) ctx.db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newApiKey(), id);
  }
  if (password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) return err('VALIDATION', `Password must be at least ${PASSWORD_MIN} characters.`, 400);
    const hash = await hashPassword(password);
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  ctx.db.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role) WHERE id = ?').run(name?.trim() || null, role || null, id);
  return ok({ user: publicUser(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
}

/** DELETE /api/admin/users/:id — removes the user; authorship refs stay (nullable FK). */
export function adminDeleteUser(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const id = Number(ctx.url.userId);
  if (id === ctx.user.id) return err('VALIDATION', 'You cannot delete yourself.', 400);
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return err('NOT_FOUND', 'User not found.', 404);
  ctx.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logActivity(ctx.db, { userId: ctx.user.id, action: 'user.register', detail: `deleted user ${u.email}` });
  return ok({ ok: true });
}

/** GET /api/admin/activity?limit= */
export function adminActivity(ctx) {
  const _e = requireAdmin(ctx); if (_e) return _e;
  const limit = Math.min(Number(ctx.query.limit ?? 50) || 50, 200);
  const rows = ctx.db.prepare(`
    SELECT a.*, u.name AS user_name, s.slug AS space_slug, p.slug AS page_slug
    FROM activity a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN spaces s ON s.id = a.space_id
    LEFT JOIN pages p ON p.id = a.page_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit);
  return ok({
    activity: rows.map((r) => ({
      id: r.id, action: r.action, detail: r.detail, created_at: r.created_at,
      user: r.user_name ?? 'system', space: r.space_slug ?? null, page: r.page_slug ?? null
    }))
  });
}


/** POST /api/render — render arbitrary markdown in the dialect (live preview). */
export function renderContent(ctx) {
  const space = spaceBySlug(ctx.db, (ctx.body ?? {}).space_slug ?? '');
  if (!space) return err('NOT_FOUND', 'Space not found.', 404);
  const s = spaceWithMembers(ctx.db, space);
  if (!can({ user: ctx.user, space: s }, 'page.view'))
    return err('FORBIDDEN', 'You do not have access to this space.', 403);
  const html = renderMarkdown((ctx.body ?? {}).content ?? '', { resolveWikilink: makeWikiResolver(ctx.db, space.slug) });
  return ok({ html });
}

/** GET /api/katex.css — KaTeX stylesheet, served from the server (offline math). */
export function katexCssRoute(ctx) {
  return { status: 200, body: katexCss(), headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=86400' } };
}

/** GET /api/katex/fonts/:file — KaTeX font files referenced by the CSS. */
export function katexFont(ctx) {
  const name = String(ctx.url.file ?? '');
  if (!/^[\w.-]+\.(woff2|woff|ttf)$/.test(name)) return err('NOT_FOUND', 'Unknown font.', 404);
  try {
    const p = katexFontPath(name);
    return { status: 200, body: readFileSync(p), headers: {
      'content-type': name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf',
      'cache-control': 'public, max-age=604800' } };
  } catch {
    return err('NOT_FOUND', 'Unknown font.', 404);
  }
}

// ---------------------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------------------

/** GET /health */
export function health(ctx) {
  return ok({ ok: true, service: 'scriptorium', time: new Date().toISOString() });
}