// Page viewer server load: propagate 404/403 from the API so broken links and
// forbidden pages return real HTTP statuses (crawlers + monitoring + SEO).
import { error } from '@sveltejs/kit';
import { apiStatus } from '$lib/server-core.js';

export async function load(event) {
  const { slug, page: pageSlug = '' } = event.params;
  const clean = String(pageSlug ?? '').replace(/\/$/, '');
  const status = clean
    ? await apiStatus(`spaces/${slug}/pages/${clean}`, event)
    : await apiStatus(`spaces/${slug}`, event);
  if (status === 404) throw error(404, 'Page not found');
  if (status === 403) throw error(403, 'You do not have access to this page');
  return {};
}