// Space overview server load: propagate the real HTTP status so missing
// spaces (404) and unauthorized private spaces (403) don't return 200.
// The UI still fetches the data client-side; this only fixes the status line.
import { error } from '@sveltejs/kit';
import { apiStatus } from '$lib/server-core.js';

export async function load(event) {
  const slug = event.params.slug;
  const status = await apiStatus(`spaces/${slug}`, event);
  if (status === 404) throw error(404, 'Space not found');
  if (status === 403) throw error(403, 'You do not have access to this space');
  return {};
}