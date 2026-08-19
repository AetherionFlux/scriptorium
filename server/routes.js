/**
 * server/routes.js — the API route table shared by the SvelteKit adapter
 * (web/src/routes/api) and the standalone dev server (server/index.js).
 *
 * Each entry: { method, pattern, handler, mutates }. `pattern` segments may be
 * `:param`; matching produces `url.params` and is merged with any static
 * segment names the handler expects (e.g. url.slug / url.spaceSlug).
 */
import * as H from './api.js';

const T = [
  // auth (noCsrf: login/registration happen before a session exists, so a
  // session-bound token is impossible; SameSite=Lax + the fact that these
  // endpoints cannot transfer existing sessions cover the CSRF surface)
  ['GET', '/auth/csrf', H.authCsrf],
  ['POST', '/auth/register', H.authRegister, true, true],
  ['POST', '/auth/login', H.authLogin, true, true],
  ['POST', '/auth/logout', H.authLogout, true, true],
  ['GET', '/auth/me', H.authMe],
  // Password reset is a pre-session flow: the user has no session (that's the
  // point), so a session-bound CSRF token is impossible — same reasoning as
  // login/register. Tokens are single-use, 1h-expiry, and never enumerable.
  ['POST', '/auth/reset', H.authReset, true, true],
  ['POST', '/auth/reset/confirm', H.authResetConfirm, true, true],

  // spaces
  ['GET', '/spaces', H.listSpaces],
  ['POST', '/spaces', H.createSpace, true],
  ['GET', '/spaces/:slug', H.getSpace],
  ['PATCH', '/spaces/:slug', H.updateSpace, true],
  ['DELETE', '/spaces/:slug', H.deleteSpace, true],
  ['GET', '/spaces/:slug/members', H.listMembers],
  ['POST', '/spaces/:slug/members', H.addMember, true],
  ['PATCH', '/spaces/:slug/members/:userId', H.updateMember, true],
  ['DELETE', '/spaces/:slug/members/:userId', H.removeMember, true],

  // pages
  ['GET', '/spaces/:spaceSlug/pages', H.listPages],
  ['POST', '/spaces/:spaceSlug/pages', H.createPage, true],
  ['GET', '/spaces/:spaceSlug/pages/:pageSlug', H.getPage],
  ['PUT', '/spaces/:spaceSlug/pages/:pageSlug', H.updatePage, true],
  ['DELETE', '/spaces/:spaceSlug/pages/:pageSlug', H.deletePage, true],
  ['POST', '/spaces/:spaceSlug/pages/:pageSlug/restore', H.restorePage, true],
  ['GET', '/spaces/:spaceSlug/pages/:pageSlug/history', H.pageHistory],
  ['GET', '/spaces/:spaceSlug/pages/:pageSlug/history/:rev', H.pageHistoryRev],
  ['POST', '/spaces/:spaceSlug/pages/:pageSlug/history/:rev/restore', H.restoreRevision, true],
  ['GET', '/spaces/:spaceSlug/pages/:pageSlug/render', H.renderPage],

  // search
  ['GET', '/search', H.search],
  ['POST', '/render', H.renderContent, false],

  // static-ish assets served from the server (offline math rendering)
  ['GET', '/katex.css', H.katexCssRoute],
  ['GET', '/katex/fonts/:file', H.katexFont],

  // admin
  ['GET', '/admin/stats', H.adminStats],
  ['GET', '/admin/users', H.adminUsers],
  ['POST', '/admin/users', H.adminCreateUser, true],
  ['PATCH', '/admin/users/:userId', H.adminUpdateUser, true],
  ['DELETE', '/admin/users/:userId', H.adminDeleteUser, true],
  ['GET', '/admin/activity', H.adminActivity],

  // misc
  ['GET', '/health', H.health]
];

export const TABLE = T.map(([method, pattern, handler, mutates, noCsrf]) => ({
  method, pattern, handler, mutates: !!mutates, noCsrf: !!noCsrf
}));

/**
 * Match a request against the table.
 * @returns {{handler, mutates, params} | null}
 */
export function match(method, path) {
  const clean = path.split('?')[0].replace(/^\/+/, '');
  for (const t of TABLE) {
    if (t.method !== method) continue;
    const pp = t.pattern.replace(/^\/+/, '').split('/');
    const cp = clean.split('/');
    if (pp.length !== cp.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(cp[i]);
      else if (pp[i] !== cp[i]) { hit = false; break; }
    }
    if (hit) return { handler: t.handler, mutates: t.mutates, noCsrf: !!t.noCsrf, params };
  }
  return null;
}

/**
 * Build the ctx object every handler expects.
 * @param {object} o
 * @param {import('better-sqlite3').Database} o.db
 * @param {string} o.secret
 * @param {object|null} o.user  full user row (with password_hash) or null
 * @param {string} o.csrf  expected CSRF token for this session
 * @param {string|null} o.csrfHeader  the request's X-CSRF-Token header (or null)
 * @param {object|null} o.body  parsed JSON body
 * @param {object} o.query
 * @param {object} o.params
 */
export function makeCtx(o) {
  return {
    db: o.db,
    secret: o.secret,
    user: o.user ? { id: o.user.id, role: o.user.role, email: o.user.email, name: o.user.name } : null,
    fullUser: o.user ?? null,
    csrf: o.csrf,
    csrfHeader: o.csrfHeader,
    body: o.body ?? {},
    query: o.query ?? {},
    url: o.params ?? {}
  };
}

/**
 * Enforce CSRF for mutating calls. Must run before the handler.
 * @returns {{status: number, body: object}|null}
 */
export function checkCsrf(ctx, mutates, noCsrf = false) {
  if (!mutates || noCsrf) return null;
  if (!ctx.user) return { status: 401, body: { error: 'Authentication required.', code: 'UNAUTHENTICATED' } };
  if (ctx.csrfHeader !== ctx.csrf)
    return { status: 403, body: { error: 'CSRF token mismatch.', code: 'CSRF' } };
  return null;
}

/** Normalize an error thrown inside a handler into a 500 response. */
export function toResponse(result) {
  if (result && typeof result.status === 'number') return result;
  return { status: 500, body: { error: 'Internal server error.', code: 'INTERNAL' } };
}