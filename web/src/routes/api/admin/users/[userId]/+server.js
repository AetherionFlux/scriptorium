/**
 * DELETE /api/admin/users/:userId — API route (SvelteKit adapter).
 *
 * Delegates to the framework-agnostic handler in `server/api.js`; see
 * server/routes.js for the full table and docs/api.md for the contract.
 */
import { dispatchApi } from '$lib/server-core.js';

async function removeHandler(request) {
  return dispatchApi(request);
}

export { removeHandler as delete }
