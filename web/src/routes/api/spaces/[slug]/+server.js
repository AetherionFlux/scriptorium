/**
 * API route (SvelteKit adapter) —  DELETE + GET + PATCH .
 *
 * All methods for this path delegate to the framework-agnostic handlers in
 * `server/api.js` via the shared route table (server/routes.js).
 */
import { dispatchApi } from '$lib/server-core.js';

export async function GET(event) {
  return dispatchApi(event);
}

export async function PATCH(event) {
  return dispatchApi(event);
}

export async function DELETE(event) {
  return dispatchApi(event);
}
