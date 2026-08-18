/**
 * DELETE /api/spaces/:slug/pages… — API route (SvelteKit adapter).
 *
 * Delegates to the framework-agnostic handler in `server/api.js`.
 */
import { dispatchApi } from '$lib/server-core.js';

async function removeHandler(request) {
  return dispatchApi(request);
}

export { removeHandler as delete }
