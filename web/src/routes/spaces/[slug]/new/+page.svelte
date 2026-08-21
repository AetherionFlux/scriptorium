<!--
  /spaces/[slug]/new — create a page (title, optional parent, then edit).
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getCsrf } from '$lib/api.js';

  const { slug } = page.params;

  let title = $state('');
  let parentSlug = $state('');
  let tree = $state([]);
  let busy = $state(false);
  let error = $state('');

  // Collect all pages (flattened) for the parent dropdown.
  async function loadTree() {
    try {
      const r = await fetch(`/api/spaces/${slug}/pages`);
      const j = await r.json();
      const flat = [];
      const walk = (nodes, prefix) => {
        for (const n of nodes ?? []) {
          flat.push({ slug: n.slug, title: `${prefix}${n.title}` });
          if (n.children?.length) walk(n.children, '— ');
        }
      };
      walk(j.tree, '');
      tree = flat;
    } catch { /* ignore */ }
  }
  onMount(loadTree);
  loadTree();

  async function create() {
    busy = true;
    error = '';
    try {
      const r = await fetch(`/api/spaces/${slug}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
        body: JSON.stringify({ title, parent_slug: parentSlug || undefined, content: '' })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      goto(`/spaces/${slug}/${j.meta.slug}/edit`);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>New page — {slug}</title></svelte:head>

<div class="max-w-xl mx-auto">
  <a href="/spaces/{slug}" class="text-xs text-parchment-faint hover:text-parchment-dim">← back to {slug}</a>
  <h1 class="text-2xl font-bold text-parchment mt-2 mb-6">New page in <span class="text-ember-400">{slug}</span></h1>

  <div class="card p-5 space-y-4">
    <div>
            <input aria-label="Title"
        class="input"
        bind:value={title}
        placeholder="My first page"
        onkeydown={(e) => e.key === 'Enter' && !busy && title.trim() && create()}
      />
      <p class="text-[11px] text-parchment-faint mt-1">The URL slug is derived from the title on first save.</p>
    </div>
    <div>
            <select aria-label="Parent page (optional)" class="input" bind:value={parentSlug}>
        <option value="">— top level —</option>
        {#each tree as t (t.slug)}
          <option value={t.slug}>{t.title}</option>
        {/each}
      </select>
    </div>
    {#if error}
      <div class="text-sm text-red-400">{error}</div>
    {/if}
    <div class="flex justify-end gap-2">
      <a class="btn btn-ghost" href="/spaces/{slug}">Cancel</a>
      <button class="btn btn-primary" disabled={busy || !title.trim()} onclick={create}>
        {busy ? 'Creating…' : 'Create page'}
      </button>
    </div>
  </div>
</div>