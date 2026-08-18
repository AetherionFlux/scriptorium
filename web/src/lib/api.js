/**
 * src/lib/api.js — browser-side API client.
 *
 * JSON + CSRF-aware fetch wrapper. The CSRF token is cached in memory after
 * each /auth/csrf or /auth/me call; mutating requests send it as a header.
 */
let _csrf = null;

export function setCsrf(t) { if (t) _csrf = t; }
export function getCsrf() { return _csrf; }

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && _csrf) headers['x-csrf-token'] = _csrf;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin'
  });

  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const put = (p, b) => api('PUT', p, b ?? {});
export const del = (p) => api('DELETE', p);

/** Refresh CSRF (call after login / on app start). */
export async function refreshCsrf() {
  try {
    const { csrf } = await get('/auth/csrf');
    setCsrf(csrf);
    return csrf;
  } catch {
    return null; // not signed in — fine
  }
}

/** Fetch current user + csrf; null when signed out. */
export async function me() {
  try {
    const { user, csrf } = await get('/auth/me');
    setCsrf(csrf);
    return user;
  } catch {
    return null;
  }
}