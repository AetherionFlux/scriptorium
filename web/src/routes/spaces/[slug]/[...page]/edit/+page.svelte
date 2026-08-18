<!--
  /spaces/[slug]/[...page]/edit — in-browser markdown editor.
  Views: edit / split / preview. Autosaves 1.2s after the last keystroke when
  dirty; manual Save button too. Templates insert callout/wikilink snippets.
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import MdEditor from '$lib/components/MdEditor.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import { getCsrf } from '$lib/api.js';
  import { toast } from '$lib/store.svelte.js';

  const { slug } = page.params;
  const pageSlug = page.params.page?.replace(/\/$/, '') ?? '';

  let title = $state('');
  let content = $state('');
  let savedContent = $state('');
  let dirty = $derived(content !== savedContent);
  let view = $state('split'); // edit | split | preview
  let meta = $state(null);
  let previewHtml = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let parentSlug = $state('');
  let pageTree = $state([]);

  const canEdit = $derived(page.data.user && page.data.user.role === 'admin' || ['editor', 'maintainer', 'owner'].includes(meta?.my_role));

  async function load() {
    try {
      const [pr, sr] = await Promise.all([
        fetch(`/api/spaces/${slug}/pages/${pageSlug}`),
        fetch(`/api/spaces/${slug}`)
      ]);
      const sj = await sr.json().catch(() => ({}));
      if (!pr.ok) {
        const pj = await pr.json().catch(() => ({}));
        error = `Cannot edit: ${pj.error ?? pr.status}`;
        loading = false;
        return;
      }
      const j = await pr.json();
      title = j.meta.title;
      content = j.content;
      savedContent = j.content;
      parentSlug = j.meta.parent_slug ?? '';
      meta = { ...j.meta, my_role: sj.space?.my_role ?? null };
      const tr = await fetch(`/api/spaces/${slug}/pages`);
      const tj = await tr.json();
      const flat = [];
      const walk = (nodes, prefix) => {
        for (const n of nodes ?? []) {
          if (n.slug !== pageSlug) flat.push({ slug: n.slug, label: `${prefix}${n.title}` });
          if (n.children?.length) walk(n.children, '— ');
        }
      };
      walk(tj.tree, '');
      pageTree = flat;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  // --- autosave -------------------------------------------------------------
  let timer = null;
  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
  }

  async function save() {
    clearTimeout(timer);
    if (saving || !canEdit) return;
    saving = true;
    error = '';
    try {
      const r = await fetch(`/api/spaces/${slug}/pages/${pageSlug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
        body: JSON.stringify({ title: title.trim() || 'Untitled', content, parent_slug: parentSlug || null })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      savedContent = content;
      meta = j.meta;
      refreshPreview();
    } catch (e) {
      error = e.message;
      toast(e.message, 'err');
    } finally {
      saving = false;
    }
  }

  function onContentChange(v) {
    content = v;
    scheduleSave();
  }

  let previewTimer = null;
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/render`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
          body: JSON.stringify({ space_slug: slug, content })
        });
        if (r.ok) {
          const j = await r.json();
          previewHtml = j.html;
        }
      } catch { /* ignore */ }
    }, 250);
  }

  // Warn on unsaved leave.
  function onBeforeUnload(e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  onMount(() => {
    window.addEventListener('beforeunload', onBeforeUnload);
    refreshPreview();
  });
  onDestroy(() => window.removeEventListener('beforeunload', onBeforeUnload));

  const templates = $derived([
    { label: '⚠ warning', title: 'Insert a warning callout', text: '\n> [!warning]\n> \n' },
    { label: '💡 tip', title: 'Insert a tip callout', text: '\n> [!tip]\n> \n' },
    { label: '📝 note', title: 'Insert a note callout', text: '\n> [!note]\n> \n' },
    { label: '🚨 danger', title: 'Insert a danger callout', text: '\n> [!danger]\n> \n' },
    { label: '📖 example', title: 'Insert an example callout', text: '\n> [!example]\n> \n' },
    { label: '[[ link ]]', title: 'Insert a wikilink', text: '[[Page name]]' },
    { label: '$ math $', title: 'Insert inline math', text: '$x^2$' },
    { label: '== mark ==', title: 'Insert a highlight', text: '==highlighted==' }
  ]);

  const statusText = $derived(
    saving ? 'Saving…' : dirty ? 'Unsaved changes' : meta ? `Saved — rev ${meta.rev}` : '…'
  );
</script>

<svelte:head><title>Edit {title} — Scriptorium</title></svelte:head>

{#if loading}
  <div class="text-parchment-faint">Loading editor…</div>
{:else if error && !meta}
  <div class="card p-6 max-w-xl mx-auto text-red-400">{error}</div>
{:else}
  <div class="flex flex-col h-[calc(100vh-8rem)]">
    <!-- toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <input
        class="input !py-1.5 font-semibold !text-lg flex-1 min-w-52"
        bind:value={title}
        oninput={scheduleSave}
        placeholder="Page title"
      />
      <select
        class="input !py-1.5 !w-44"
        value={parentSlug}
        onchange={(e) => {
          parentSlug = e.target.value;
          scheduleSave();
        }}>
        <option value="">Top level</option>
        {#each pageTree as p (p.slug)}
          <option value={p.slug}>{p.label}</option>
        {/each}
      </select>

      <div class="flex rounded-md border border-ink-700 overflow-hidden">
        {#each ['edit', 'split', 'preview'] as v (v)}
          <button
            class="px-3 py-1.5 text-xs cursor-pointer {view === v ? 'bg-ink-700 text-parchment' : 'text-parchment-faint hover:text-parchment'}"
            onclick={() => (view = v)}>
            {v}
          </button>
        {/each}
      </div>

      <span class="text-xs {dirty ? 'text-ember-400' : 'text-parchment-faint'}">{statusText}</span>
      <button class="btn-primary !text-xs" disabled={!dirty || !canEdit} onclick={save}>Save</button>
      <a class="btn-ghost !text-xs" href="/spaces/{slug}/{pageSlug}">View</a>
    </div>

    {#if error}
      <div class="text-sm text-red-400 mb-2">{error}</div>
    {/if}

    <!-- editor / preview panes -->
    <div class="flex-1 min-h-0 grid gap-3 {view === 'edit' ? 'grid-cols-1' : view === 'preview' ? 'grid-cols-1' : 'lg:grid-cols-2'}">
      {#if view !== 'preview'}
        <div class="card overflow-hidden flex flex-col">
          <MdEditor value={content} onchange={onContentChange} {templates} ph="Write markdown… (autosaves)" />
        </div>
      {/if}
      {#if view !== 'edit'}
        <div class="card overflow-y-auto p-5">
          {#if previewHtml}
            <MarkdownView html={previewHtml} />
          {:else}
            <div class="text-parchment-faint text-sm">Preview…</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}