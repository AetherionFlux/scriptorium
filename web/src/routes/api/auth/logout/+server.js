/**
 * API route (SvelteKit adapter) —  POST .
 *
 * All methods for this path delegate to the framework-agnostic handlers in
 * `server/api.js` via the shared route table (server/routes.js).
 */
import { dispatchApi } from '$lib/server-core.js';

export async function POST(event) {
  return dispatchApi(event);
}
