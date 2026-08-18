/**
 * src/lib/store.svelte — tiny global state: current user + toasts.
 * Svelte 5 runes module (import as a module, use exported runes).
 */
import { me } from './api.js';

let user = $state(null);
let checked = $state(false);
let toasts = $state([]);

/** Load the current session once at layout mount. */
export async function initAuth() {
  user = await me();
  checked = true;
  return user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  user = null;
  toasts = [];
}

export function setUser(u) { user = u; }

/** Show a transient toast. type: 'ok' | 'err' */
export function toast(msg, type = 'ok', ms = 3500) {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, msg, type }];
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, ms);
}

/** Read access to the state (Svelte 5 rune access outside components). */
export const state = {
  get user() { return user; },
  get checked() { return checked; },
  get toasts() { return toasts; }
};