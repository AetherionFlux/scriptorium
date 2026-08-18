/**
 * web/src/lib/server-core.js — SvelteKit adapter for the server core.
 *
 * Boots the database + secret once per process, resolves the request user
 * from the session cookie (or X-Api-Key), enforces CSRF on mutating calls,
 * and dispatches to server/api.js via the shared route table.
 */
import { openDb } from 'scriptorium-server/db.js';
import { seed } from 'scriptorium-server/seed.js';
import { loadOrCreateSecret, verifySessionToken, csrfFor, COOKIE_NAME } from 'scriptorium-server/auth.js';
import { match, makeCtx, checkCsrf, toResponse } from 'scriptorium-server/routes.js';

let _db = null;
let _secret = null;
let _userStmt = null;

/** Lazily boot the data layer (idempotent; SvelteKit may re-import). */
export function core() {
  if (!_db) {
    const dataDir = process.env.DATA_DIR || new URL('../../../data/', import.meta.url).pathname;
    _db = openDb(dataDir);
    seed(_db);
    _secret = loadOrCreateSecret(dataDir);
    _userStmt = _db.prepare('SELECT * FROM users WHERE id = ?');
  }
  return { db: _db, secret: _secret, userStmt: _userStmt };
}

/** Parse cookies from a SvelteKit Request. */
function cookiesOf(request) {
  const out = {};
  for (const c of request.cookies.getAll()) out[c.name] = c.value;
  return out;
}

/**
 * Resolve the current user from the session cookie, falling back to an API key.
 * @returns {{user: object|null, session: string|null, csrf: string|null}}
 */
export function resolveUser(request) {
  const { secret, userStmt, db } = core();
  const cookies = cookiesOf(request);
  const session = cookies[COOKIE_NAME] ?? null;
  const uid = verifySessionToken(session, secret);
  let user = uid ? userStmt.get(uid) ?? null : null;
  if (!user) {
    const key = request.headers.get('x-api-key');
    if (key) user = db.prepare('SELECT * FROM users WHERE api_key = ?').get(key) ?? null;
  }
  return { user, session, csrf: session ? csrfFor(session, secret) : null };
}

/**
 * The universal API dispatcher. Each +server.js route calls this with the
 * request; the shared table (server/routes.js) picks the handler.
 */
export async function dispatchApi(request) {
  const { db, secret, userStmt } = core();
  const url = new URL(request.url);
  const pathAfterApi = url.pathname.replace(/^\/api\//, '');
  const m = match(request.method, pathAfterApi);
  if (!m) return jsonResp(404, { error: 'Unknown endpoint.', code: 'NOT_FOUND' });

  const { user, session, csrf } = resolveUser(request);

  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    try {
      body = (await request.json()) ?? {};
    } catch {
      return jsonResp(400, { error: 'Body must be valid JSON.', code: 'VALIDATION' });
    }
  }

  const ctx = makeCtx({
    db, secret, user,
    csrf,
    csrfHeader: request.headers.get('x-csrf-token'),
    body,
    query: Object.fromEntries(url.searchParams),
    params: m.params
  });

  const blocked = checkCsrf(ctx, m.mutates, m.noCsrf);
  if (blocked) return jsonResp(blocked.status, blocked.body);
  try {
    const r = toResponse(await m.handler(ctx));
    return jsonResp(r.status, r.body, r.headers);
  } catch (e) {
    console.error('[scriptorium] handler error', request.method, pathAfterApi, e);
    return jsonResp(500, { error: 'Internal server error.', code: 'INTERNAL' });
  }
}

export function jsonResp(status, body, headers = {}) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return new Response(body, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

/**
 * Build a fetch() wrapper for the browser: JSON + CSRF token.
 * The CSRF token comes from the /auth/csrf response cached by the UI.
 */
export function makeApiFetch(getCsrf) {
  return async function api(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    const token = getCsrf?.();
    if (token) headers['x-csrf-token'] = token;
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const e = new Error(data?.error ?? `Request failed (${res.status})`);
      e.status = res.status;
      e.code = data?.code;
      throw e;
    }
    return data;
  };
}