/**
 * server/index.js — standalone API server (used in development; the vite dev
 * server proxies /api → here). In production the SvelteKit app (adapter-node)
 * serves UI + API in one process, so this file is not the production entry —
 * but it exercises the exact same handlers, which keeps dev == prod behavior.
 *
 * Env:
 *   PORT      (default 4000)
 *   DATA_DIR  (default ./data)
 */
import http from 'node:http';
import { openDb } from './db.js';
import { seed } from './seed.js';
import { loadOrCreateSecret, verifySessionToken, csrfFor, COOKIE_NAME } from './auth.js';
import { match, makeCtx, checkCsrf, toResponse } from './routes.js';

const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = process.env.DATA_DIR || new URL('../data/', import.meta.url).pathname;

const db = openDb(DATA_DIR);
seed(db);
const secret = loadOrCreateSecret(DATA_DIR);

const userStmt = db.prepare('SELECT * FROM users WHERE id = ?');

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  const send = (status, body, headers = {}) => {
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      res.writeHead(status, headers);
      return res.end(body);
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };

  if (path === '/health') return send(200, { ok: true, service: 'scriptorium', time: new Date().toISOString() });

  if (path.startsWith('/api/')) {
    const m = match(req.method, path.slice(4));
    if (!m) return send(404, { error: 'Unknown endpoint.', code: 'NOT_FOUND' });

    const cookies = parseCookies(req);
    const session = cookies[COOKIE_NAME] ?? null;
    const uid = verifySessionToken(session, secret);
    const user = uid ? userStmt.get(uid) ?? null : null;
    const csrf = user ? csrfFor(session, secret) : null;

    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const parsed = await readJson(req);
      if (parsed === null) return send(400, { error: 'Body must be valid JSON.', code: 'VALIDATION' });
      body = parsed;
    }

    const ctx = makeCtx({
      db, secret, user,
      csrf,
      csrfHeader: req.headers['x-csrf-token'] ?? null,
      body,
      query: Object.fromEntries(url.searchParams),
      params: m.params
    });

    const blocked = checkCsrf(ctx, m.mutates, m.noCsrf);
    if (blocked) return send(blocked.status, blocked.body);
    try {
      const result = await m.handler(ctx);
      const r = toResponse(result);
      const headers = {};
      if (r.headers) for (const [k, v] of Object.entries(r.headers)) headers[k.toLowerCase()] = v;
      return send(r.status, r.body, headers);
    } catch (e) {
      console.error('handler error', m.pattern, e);
      return send(500, { error: 'Internal server error.', code: 'INTERNAL' });
    }
  }

  send(404, { error: 'Not found.', code: 'NOT_FOUND' });
});

server.listen(PORT, () => {
  console.log(`[scriptorium] API listening on :${PORT} (data: ${DATA_DIR})`);
});