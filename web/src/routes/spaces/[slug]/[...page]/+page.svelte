<!--
  /spaces/[slug]/[...page] — page viewer.
  The rest-param [...page] supports deep hierarchies (/spaces/dev/deploy/guide).
  Actions shown depend on the viewer's role in the space (server re-checks all of them).
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import { getCsrf } from '$lib/api.js';
  import { toast } from '$lib/store.svelte.js';

  const { slug } = page.params;
  const pageSlug = page.params.page?.replace(/\/$/, '') ?? '';

  let meta = $state(null);
  let html = $state('');
  let error = $state('');
  let status = $state(0);
  let myRole = $state(null);
  let showHistory = $state(false);
  let history = $state([]);
  let selectedRev = $state(null);
  let renderedRev = $state('');

  const isAdmin = $derived(page.data.user?.role === 'admin');
  const canEdit = $derived(!!meta && (isAdmin || ['editor', 'maintainer', 'owner'].includes(myRole)));
  const canRestore = $derived(isAdmin || ['maintainer', 'owner'].includes(myRole));

  async function load() {
    error = '';
    status = 0;
    meta = null;
    html = '';
    try {
      const [pr, sr] = await Promise.all([
        fetch(`/api/spaces/${slug}/pages/${pageSlug}/render`),
        fetch(`/api/spaces/${slug}`)
      ]);
      const sj = await sr.json().catch(() => ({}));
      myRole = sj.space?.my_role ?? null;
      const pj = await pr.json().catch(() => ({}));
      if (!pr.ok) {
        status = pr.status;
        error = pj.error ?? 'Not found';
        return;
      }
      html = pj.html;
      const mr = await fetch(`/api/spaces/${slug}/pages/${pageSlug}`);
      const mj = await mr.json();
      if (!mr.ok) {
        status = mr.status;
        error = mj.error;
        return;
      }
      meta = mj.meta;
    } catch (e) {
      error = e.message;
    }
  }
  onMount(load);
  load();

  async function openHistory() {
    const r = await fetch(`/api/spaces/${slug}/pages/${pageSlug}/history`);
    const j = await r.json();
    history = j.history ?? [];
    selectedRev = null;
    renderedRev = '';
    showHistory = true;
  }

  async function viewRev(rev) {
      const mr = await fetch(`/api/spaces/${slug}/pages/${pageSlug}/history/${rev}`);
      const j = await mr.json();
      if (!mr.ok) return toast(j.error, 'err');
      selectedRev = j;
      // Render the revision content server-side (same dialect as the page).
      const pr = await fetch(`/api/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
        body: JSON.stringify({ space_slug: slug, content: j.content })
      });
      const pj = await pr.json().catch(() => ({}));
      renderedRev = pr.ok ? pj.html : '';
    }

  async function restoreRev(rev) {
    if (!confirm(`Restore revision ${rev} as a new save?`)) return;
    const r = await fetch(`/api/spaces/${slug}/pages/${pageSlug}/history/${rev}/restore`, {
      method: 'POST',
      headers: { 'x-csrf-token': getCsrf() ?? '' }
    });
    const j = await r.json();
    if (!r.ok) return toast(j.error, 'err');
    toast('Revision restored');
    showHistory = false;
    load();
  }

  async function del() {
    if (!confirm(`Delete "${meta?.title}"? Maintainers can restore it later.`)) return;
    const r = await fetch(`/api/spaces/${slug}/pages/${pageSlug}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': getCsrf() ?? '' }
    });
    const j = await r.json();
    if (!r.ok) return toast(j.error, 'err');
    toast('Page deleted');
    goto(`/spaces/${slug}`);
  }

  async function restoreDeleted() {
    const r = await fetch(`/api/spaces/${slug}/pages/${pageSlug}/restore`, {
      method: 'POST',
      headers: { 'x-csrf-token': getCsrf() ?? '' }
    });
    const j = await r.json();
    if (!r.ok) return toast(j.error, 'err');
    toast('Page restored');
    load();
  }

  const crumbs = $derived(pageSlug.split('/'));
</script>

<svelte:head><title>{meta?.title ?? pageSlug} — Scriptorium</title></svelte:head>

{#if status === 404}
  <div class="card p-8 text-center max-w-xl mx-auto">
    <div class="text-4xl mb-3">🕳</div>
    <div class="text-parchment font-medium mb-1">Page not found</div>
    <div class="text-sm text-parchment-dim mb-4">{error}</div>
    {#if canRestore}
      <button class="btn btn-ghost" onclick={restoreDeleted}>Restore deleted page</button>
    {/if}
    <a class="btn btn-primary" href="/spaces/{slug}">Back to space</a>
  </div>
{:else if status === 403}
  <div class="card p-8 text-center max-w-xl mx-auto">
    <div class="text-4xl mb-3">🔒</div>
    <div class="text-parchment font-medium mb-1">No access</div>
    <div class="text-sm text-parchment-dim mb-4">{error}</div>
    <a class="btn btn-primary" href="/spaces/{slug}">Back to space</a>
  </div>
{:else if meta === null}
  <div class="text-parchment-faint">Loading…</div>
{:else}
  <div class="max-w-3xl mx-auto">
    <!-- breadcrumbs -->
    <div class="flex items-center gap-1.5 text-xs text-parchment-faint mb-4 flex-wrap">
      <a href="/spaces/{slug}" class="hover:text-parchment-dim">{slug}</a>
      {#each crumbs as c, i (c)}
        <span>/</span>
        {#if i < crumbs.length - 1}
          <a href="/spaces/{slug}/{crumbs.slice(0, i + 1).join('/')}" class="hover:text-parchment-dim">{c}</a>
        {:else}
          <span class="text-parchment-dim">{c}</span>
        {/if}
      {/each}
    </div>

    <!-- header -->
    <div class="flex flex-wrap items-center gap-2 mb-6">
      <h1 class="text-2xl font-bold text-parchment flex-1">{meta.title}</h1>
      {#if canEdit}
        <a class="btn btn-primary btn-sm" href="/spaces/{slug}/{pageSlug}/edit">Edit</a>
      {/if}
      {#if canEdit || canRestore}
        <button class="btn btn-ghost btn-sm" onclick={openHistory}>History</button>
      {/if}
      {#if canRestore || meta.created_by === page.data.user?.id}
        <button class="btn btn-danger btn-sm" onclick={del}>Delete</button>
      {/if}
    </div>

    <MarkdownView html={html} />

    <div class="mt-10 pt-4 border-t border-ink-800 text-xs text-parchment-faint flex flex-wrap gap-x-4 gap-y-1">
      <span>rev {meta.rev}</span>
      <span>updated {meta.updated_at}</span>
      <span>created {meta.created_at}</span>
    </div>
  </div>

  <!-- history dialog -->
  {#if showHistory}
    <div
      role="button"
      tabindex="-1"
      aria-label="Close dialog"
      onkeydown={(e) => {
        if (e.key !== 'Escape') return;
        showHistory = false;
        selectedRev = null;
      }}
      class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onclick={() => {
        showHistory = false;
        selectedRev = null;
      }}>
      <button
        aria-label="Close dialog"
        class="absolute inset-0 cursor-default"
        onclick={() => (showHistory = false)}
      ></button>
      <div class="card relative card w-full max-w-lg max-h-[80vh] overflow-y-auto p-5">
        <h2 class="text-lg font-semibold text-parchment mb-4">Revision history</h2>
        {#each history as h (h.rev)}
          <div class="flex items-center gap-3 py-2 border-b border-ink-800">
            <span class="badge-role shrink-0">rev {h.rev}</span>
            <span class="text-sm text-parchment-dim flex-1 truncate">{h.author ?? 'system'} — {h.created_at}</span>
            <button class="btn btn-ghost btn-sm" onclick={() => viewRev(h.rev)}>view</button>
            {#if canEdit}
              <button class="btn btn-primary btn-sm" onclick={() => restoreRev(h.rev)}>restore</button>
            {/if}
          </div>
        {:else}
          <div class="text-sm text-parchment-faint">No history.</div>
        {/each}
        {#if selectedRev}
          <div class="mt-4">
            <div class="text-xs text-parchment-faint mb-2">
              Revision {selectedRev.rev} — “{selectedRev.title}”
            </div>
            <MarkdownView html={renderedRev} fallback="Rendering revision…" />
          </div>
        {/if}
        <div class="flex justify-end mt-4">
          <button class="btn btn-ghost" onclick={() => { showHistory = false; selectedRev = null; }}>Close</button>
        </div>
      </div>
    </div>
  {/if}
{/if}