/**
 * server/ratelimit.js — in-memory per-IP rate limiting for auth endpoints.
 *
 * Why: argon2id verification is deliberately expensive, and an unthrottled
 * login/register/reset endpoint on a public host is a DoS/brute-force vector.
 *
 * Scope: single-process, in-memory. Scriptorium deploys as one binary on one
 * port (single SQLite volume), so per-process state is per-deployment state.
 * If you ever run multiple replicas behind a load balancer, move this to a
 * shared store (Redis) — the check/checkAuthRate signatures won't change.
 *
 * The window is a hard per-IP reset: `max` requests per `windowMs`, then 429
 * with a Retry-After hint until the window clears. Keys are (ip, endpoint).
 */

/**
 * @param {object} opts
 * @param {number} opts.windowMs  window length in ms
 * @param {number} opts.max       max requests per window per key
 * @param {() => number} [opts.now]  injectable clock (tests)
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = now();

  function sweep() {
    const t = now();
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }

  return {
    /**
     * @param {string} key
     * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
     */
    check(key) {
      sweep();
      const t = now();
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
      }
      if (cur.count >= max) {
        return { allowed: false, remaining: 0, retryAfterMs: cur.resetAt - t };
      }
      cur.count += 1;
      return { allowed: true, remaining: max - cur.count, retryAfterMs: 0 };
    },
    /** Test/introspection: number of live keys. */
    size: () => hits.size,
    /** Test: drop all keys. */
    reset: () => { hits.clear(); lastSweep = now(); }
  };
}

/**
 * Per-endpoint limits. Login is the brute-force vector (harshest); register
 * and reset prevent account-spray / reset-flood. Chosen for a single-tenant
 * team wiki: generous enough that real users won't trip them, strict enough
 * that a script can't burn the box.
 */
const LIMITS = {
  'auth/login': { windowMs: 15 * 60 * 1000, max: 20 },      // 20 / 15 min
  'auth/register': { windowMs: 60 * 60 * 1000, max: 5 },    // 5 / hour
  'auth/reset': { windowMs: 60 * 60 * 1000, max: 10 },      // 10 / hour
  'auth/reset/confirm': { windowMs: 60 * 60 * 1000, max: 10 }
};

const limiters = {};
for (const [path, cfg] of Object.entries(LIMITS)) {
  limiters[path] = createRateLimiter(cfg);
}

/**
 * @param {string} pathAfterApi  e.g. 'auth/login' (no leading /api)
 * @returns {{path: string, limiter: ReturnType<typeof createRateLimiter>}|null}
 */
export function authLimiterFor(pathAfterApi) {
  return limiters[pathAfterApi] ? { path: pathAfterApi, limiter: limiters[pathAfterApi] } : null;
}

/**
 * Extract the client IP from a fetch/Node request's headers. Behind a proxy,
 * trust X-Forwarded-For's leftmost hop (set by your ingress) or X-Real-Ip.
 * Only ever called when the direct peer is a local proxy (see checkAuthRate).
 */
export function clientIpOf(request) {
  const xff = request.headers?.get?.('x-forwarded-for') ?? request.headers?.['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const xri = request.headers?.get?.('x-real-ip') ?? request.headers?.['x-real-ip'];
  if (xri) return String(xri).trim();
  return '127.0.0.1';
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Framework-agnostic gate. Call before resolving the user / running the
 * handler. Returns null when the request may proceed, or a 429-shaped result.
 *
 * @param {Request} request
 * @param {string} pathAfterApi  e.g. 'auth/login' (no leading /api)
 * @param {string} [peerIp]      the direct peer (socket) address, when known —
 *   SvelteKit's event.clientAddress or Node's req.socket.remoteAddress. When
 *   the peer is a local proxy (loopback) we fall back to X-Forwarded-For so a
 *   fronted deployment still rates by real client; when the peer is public we
 *   never trust client-set XFF (a direct client could rotate it to evade).
 * @returns {null | {status: number, body: {error: string, code: string}, headers: Object}}
 */
export function checkAuthRate(request, pathAfterApi, peerIp) {
  const entry = authLimiterFor(pathAfterApi);
  if (!entry) return null;
  const ip = peerIp && !isLoopback(peerIp) ? peerIp : clientIpOf(request);
  const res = entry.limiter.check(ip);
  if (res.allowed) return null;
  const secs = Math.max(1, Math.ceil(res.retryAfterMs / 1000));
  return {
    status: 429,
    body: { error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
    headers: { 'retry-after': String(secs) }
  };
}

/** Reset all limiters (tests). */
export function _resetLimiters() {
  for (const l of Object.values(limiters)) l.reset();
}