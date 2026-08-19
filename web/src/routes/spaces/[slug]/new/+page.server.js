// New-page server load: the space must exist (404) and the user must be able
// to see it (403) before we show the editor.
import { error } from '@sveltejs/kit';
import { apiStatus } from '$lib/server-core.js';

export async function load(event) {
  const slug = event.params.slug;
  const status = await apiStatus(`spaces/${slug}`, event);
  if (status === 404) throw error(404, 'Space not found');
  if (status === 403) throw error(403, 'You do not have access to this space');
  return {};
}