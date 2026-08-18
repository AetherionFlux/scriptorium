/**
 * POST /api/spaces/:slug/members — API route (SvelteKit adapter).
 *
 * Delegates to the framework-agnostic handler in `server/api.js`; see
 * server/routes.js for the full table and docs/api.md for the contract.
 */
import { dispatchApi } from '$lib/server-core.js';

export async function post(request) {
  return dispatchApi(request);
}
