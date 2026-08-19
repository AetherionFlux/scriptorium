// Root layout server-side load: resolves the current user from the session
// cookie (or API key header) so the app shell can render correctly on first
// paint. Runs only in the Node server context — never bundled for the client.
import { resolveUser } from '$lib/server-core.js';

export async function load(event) {
  const user = resolveUser(event.request);
  return { user };
}