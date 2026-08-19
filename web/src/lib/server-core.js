/**
 * web/src/lib/server-core.js — SvelteKit adapter for the server core.
 *
 * Boots the database + secret once per process, resolves the request user
 * from the session cookie (or X-Api-Key), enforces CSRF on mutating calls,
 * and dispatches to server/api.js via the shared route table.
 *
 * The backend is loaded through `createRequire` at runtime instead of static
 * `import`s: SvelteKit's production build would otherwise inline the
 * workspace package into the ESM server bundle, which breaks native CJS
 * dependencies (argon2 references `__dirname`, which does not exist in the
 * emitted ESM chunks). Requiring keeps the backend as real Node modules —
 * the same code path the dev server and the standalone server use.
 */
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const backend = (mod) => req(`scriptorium-server/${mod}`);

const { openDb } = backend('db.js');
const { seed } = backend('seed.js');
const { loadOrCreateSecret, verifySessionToken, csrfFor, COOKIE_NAME } = backend('auth.js');
const { match, makeCtx, checkCsrf, toResponse } = backend('routes.js');
const { checkAuthRate } = backend('ratelimit.js');

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

/** Parse cookies from a SvelteKit request (header-based; no Request.cookies dep). */
function cookiesOf(request) {
  const out = {};
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
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
 * SvelteKit RouteEvent; the shared table (server/routes.js) picks the handler.
 */
export async function dispatchApi(event) {
  const request = event.request;
  const pathAfterApi = event.url.pathname.replace(/^\/api\//, '');
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    try {
      body = (await request.json()) ?? {};
    } catch {
      return jsonResp(400, { error: 'Body must be valid JSON.', code: 'VALIDATION' });
    }
  }
  const query = Object.fromEntries(event.url.searchParams);
  return runApi(request.method, pathAfterApi, request, { body, query, clientAddress: event.clientAddress });
}

/**
 * Core API pipeline: match the route table, resolve the user, enforce CSRF,
 * run the handler → Response. Shared by dispatchApi and apiStatus so the two
 * can never drift apart.
 */
async function runApi(method, pathAfterApi, request, { body = {}, query = {}, clientAddress }) {
  const { db, secret } = core();
  const m = match(method, pathAfterApi);
  if (!m) return jsonResp(404, { error: 'Unknown endpoint.', code: 'NOT_FOUND' });

  // Throttle auth endpoints per IP before doing any real work (argon2 is
  // deliberately expensive — an unthrottled login is a DoS vector).
  // Non-auth paths return null immediately.
  const rl = checkAuthRate(request, pathAfterApi, clientAddress);
  if (rl) return jsonResp(rl.status, rl.body, rl.headers);

  const { user, csrf } = resolveUser(request);
  const ctx = makeCtx({
    db, secret, user,
    csrf,
    csrfHeader: request.headers.get('x-csrf-token'),
    body,
    query,
    params: m.params
  });

  const blocked = checkCsrf(ctx, m.mutates, m.noCsrf);
  if (blocked) return jsonResp(blocked.status, blocked.body);
  try {
    const r = toResponse(await m.handler(ctx));
    return jsonResp(r.status, r.body, r.headers);
  } catch (e) {
    console.error('[scriptorium] handler error', method, pathAfterApi, e);
    return jsonResp(500, { error: 'Internal server error.', code: 'INTERNAL' });
  }
}

/**
 * HTTP status the API would return for a GET of `pathAfterApi` on this
 * request's user. Used by +page.server.js loaders so page routes propagate
 * real 404/403 statuses instead of the 200 SPA shell.
 */
export async function apiStatus(pathAfterApi, event, query = {}) {
  const res = await runApi('GET', pathAfterApi, event.request, { body: {}, query });
  return res.status;
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