<!--
  /spaces/[slug] — space overview: header, description, page tree + landing page.
  The landing page is the space's "getting-started" or "welcome" page if it
  exists, otherwise a hint. Maintainers see space settings + members.
-->
<script>
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import PageTree from '$lib/components/PageTree.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';

  const { slug } = page.params;

  let space = $state(null);
  let tree = $state(null);
  let members = $state(null);
  let error = $state('');
  let landingHtml = $state('');
  let showSettings = $state(false);
  let showMembers = $state(false);

  async function load() {
    error = '';
    try {
      const r = await fetch(`/api/spaces/${slug}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      space = j.space;
      tree = j.tree;
      members = j.members;

      // Landing page: prefer getting-started, then welcome, else nothing.
      for (const candidate of ['getting-started', 'welcome']) {
        if (findInTree(tree, candidate)) {
          const pr = await fetch(`/api/spaces/${slug}/pages/${candidate}/render`);
          if (pr.ok) {
            const pj = await pr.json();
            landingHtml = pj.html;
          }
          break;
        }
      }
    } catch (e) {
      error = e.message;
    }
  }
  onMount(load);
  load();

  function findInTree(nodes, s) {
    for (const n of nodes ?? []) {
      if (n.slug === s) return n;
      const f = findInTree(n.children, s);
      if (f) return f;
    }
    return null;
  }

  const isMaintainer = $derived(space && ['owner', 'maintainer'].includes(space.my_role ?? ''));
</script>

<svelte:head><title>{space?.name ?? 'Space'} — Scriptorium</title></svelte:head>

{#if error}
  <div class="card p-6 text-red-400">{error}</div>
{:else if space === null}
  <div class="text-parchment-faint">Loading…</div>
{:else}
  <div class="flex flex-col lg:flex-row gap-6">
    <!-- left: tree -->
    <aside class="lg:w-72 shrink-0">
      <div class="card p-3">
        <div class="flex items-center justify-between px-2 py-1">
          <span class="text-xs font-semibold uppercase tracking-wider text-parchment-faint">Pages</span>
          <a href="/spaces/{slug}/new" class="text-xs text-ember-400 hover:text-ember-300">+ new</a>
        </div>
        <PageTree {tree} spaceSlug={slug} />
      </div>
    </aside>

    <!-- right: header + landing -->
    <div class="flex-1 min-w-0">
      <div class="flex flex-wrap items-center gap-3 mb-1">
        <h1 class="text-2xl font-bold text-parchment">{space.name}</h1>
        {#if space.visibility === 'private'}
          <span class="badge-private">private</span>
        {:else}
          <span class="badge-public">public</span>
        {/if}
        {#if isMaintainer}
          <div class="ml-auto flex gap-2">
            <button class="btn-ghost !text-xs" onclick={() => { showSettings = !showSettings; showMembers = false; }}>
              Settings
            </button>
            <button class="btn-ghost !text-xs" onclick={() => { showMembers = !showMembers; showSettings = false; }}>
              Members
            </button>
          </div>
        {/if}
      </div>
      <p class="text-sm text-parchment-dim mb-6">{space.description}</p>

      {#if showSettings}
        <SpaceSettings {space} ondone={load} />
      {:else if showMembers}
        <MembersPanel spaceSlug={slug} {members} ondone={load} />
      {:else if landingHtml}
        <MarkdownView html={landingHtml} />
      {:else}
        <div class="card p-8 text-center">
          <div class="text-4xl mb-3">🪶</div>
          <div class="text-parchment font-medium mb-1">An empty space</div>
          <div class="text-sm text-parchment-dim mb-4">Create a page to get started.</div>
          <a class="btn-primary" href="/spaces/{slug}/new">Create the first page</a>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Space settings (maintainers) -->
{#if showSettings && space}
  <div
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    onkeydown={(e) => e.key === 'Escape' && (showSettings = false)}
    onclick={() => (showSettings = false)}>
    <button
      aria-label="Close dialog"
      class="absolute inset-0 cursor-default"
      onclick={() => (showSettings = false)}
    ></button>
    <div class="card relative card w-full max-w-md p-5">
      <SpaceSettings {space} ondone={() => { showSettings = false; load(); }} />
    </div>
  </div>
{/if}