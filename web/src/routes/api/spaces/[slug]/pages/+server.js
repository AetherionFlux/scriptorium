/**
 * POST /api/spaces/:slug/pages… — API route (SvelteKit adapter).
 *
 * Delegates to the framework-agnostic handler in `server/api.js`.
 */
import { dispatchApi } from '$lib/server-core.js';

export async function post(request) {
  return dispatchApi(request);
}
