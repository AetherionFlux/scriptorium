/**
 * server/auth.js — password hashing, stateless signed sessions, CSRF, API keys.
 *
 * Sessions are a single HMAC-signed token: base64url(payload).base64url(hmac).
 * The server secret lives in the data dir (auto-generated on first boot) unless
 * SESSION_SECRET is set explicitly — which is how you keep sessions alive across
 * container rebuilds.
 */
import argon2 from 'argon2';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const COOKIE_NAME = 'sc_session';
export const COOKIE_TTL_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || 30);

/** Load the session signing secret from env, else create/read it in the data dir. */
export function loadOrCreateSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const p = join(dataDir, 'secret.key');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  writeFileSync(p, s, { mode: 0o600 });
  return s;
}

const b64u = (b) => b.toString('base64url');
const hmac = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

/** Hash a password with argon2id. */
export function hashPassword(password) {
  return argon2.hash(password, { memoryCost: 256 * 1024, iterations: 3, parallelism: 4 });
}

/** Constant-time-ish verify (argon2.verify is already constant-time on match). */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Create a signed session token for a user id. */
export function createSessionToken(userId, secret, ttlDays = COOKIE_TTL_DAYS) {
  const payload = b64u(Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + ttlDays * 86400 })));
  return `${payload}.${hmac(payload, secret)}`;
}

/** Verify a session token; returns the user id or null. */
export function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = hmac(payload, secret);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.uid || typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.uid;
}

/** CSRF token derived from the session token (double-submit: no storage needed). */
export function csrfFor(sessionToken, secret) {
  return hmac(`${sessionToken}.csrf`, secret);
}

/** Fresh random API key (hex). */
export function newApiKey() {
  return randomBytes(32).toString('hex');
}

/** Fresh password-reset token. */
export function newResetToken() {
  return randomBytes(24).toString('hex');
}

/** Cookie attributes for the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_TTL_DAYS * 86400,
    path: '/'
  };
}