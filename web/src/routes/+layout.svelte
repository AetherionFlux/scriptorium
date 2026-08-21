<!--
  Root layout: app shell (top nav, space switcher, search, user menu, toasts).
  The current user is resolved server-side from the session cookie so the
  shell renders correctly on first paint; the client re-checks on mount.
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import '../app.css';
  import { initAuth, logout, state as store } from '$lib/store.svelte.js';
  import { getCsrf } from '$lib/api.js';

  let { data, children } = $props();

  let q = $state('');
  let showUserMenu = $state(false);
  let showNewSpace = $state(false);
  let showSpaces = $state(false);
  let spaces = $state([]);
  let searchResults = $state(null);
  let searching = $state(false);

  onMount(async () => {
    await initAuth(data.user ?? null);
    window.addEventListener('scriptorium:new-space', openNewSpace);
    window.addEventListener('scriptorium:refresh-spaces', loadSpaces);
  });

  async function loadSpaces() {
    try {
      const r = await fetch('/api/spaces');
      const j = await r.json();
      spaces = j.spaces ?? [];
    } catch {
      /* ignore */
    }
  }
  loadSpaces();

  function openNewSpace() {
    showSpaces = false;
    showNewSpace = true;
  }

  async function onSearch(e) {
    if (e.key !== 'Enter' || !q.trim()) return;
    searching = true;
    searchResults = null;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      searchResults = j.results ?? [];
    } finally {
      searching = false;
    }
    showSpaces = false;
  }

  async function doLogout() {
    showUserMenu = false;
    await logout();
    goto('/login');
  }

  // New-space dialog state
  let ns = $state({ name: '', description: '', visibility: 'public', slug: '' });
  let nsBusy = $state(false);
  let nsError = $state('');

  async function createSpace() {
    nsBusy = true;
    nsError = '';
    try {
      const r = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
        body: JSON.stringify(ns)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Could not create space');
      showNewSpace = false;
      ns = { name: '', description: '', visibility: 'public', slug: '' };
      loadSpaces();
      goto(`/spaces/${j.space.slug}`);
    } catch (e) {
      nsError = e.message;
    } finally {
      nsBusy = false;
    }
  }

  const currentSpace = $derived(page.url.pathname.split('/')[1] || '');
</script>

<svelte:head>
  <title>Scriptorium — markdown wiki</title>
</svelte:head>

<div class="min-h-screen flex flex-col">
  <nav class="sticky top-0 z-40 bg-ink-950/90 backdrop-blur border-b border-ink-800">
    <div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
      <a href="/" class="flex items-center gap-2 font-bold text-parchment shrink-0">
        <span class="text-ember-400 text-xl">✒</span>
        <span class="hidden xs:inline">Scriptorium</span>
      </a>

      <!-- space switcher -->
      <div class="relative hidden sm:block">
        <button
          class="btn btn-ghost btn-sm"
          onclick={() => {
            showSpaces = !showSpaces;
            showUserMenu = false;
            loadSpaces();
          }}>
          Spaces <span class="text-parchment-faint">▾</span>
        </button>
        {#if showSpaces}
          <div class="absolute left-0 mt-1 w-72 card shadow-xl shadow-black/50 p-2 max-h-96 overflow-y-auto">
            {#each spaces as s (s.slug)}
              <a
                href="/spaces/{s.slug}"
                class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800"
                onclick={() => (showSpaces = false)}>
                <span class="text-sm text-parchment truncate">{s.name}</span>
                {#if s.visibility === 'private'}
                  <span class="badge-private">private</span>
                {/if}
              </a>
            {:else}
              <div class="px-2 py-2 text-sm text-parchment-faint">No spaces yet.</div>
            {/each}
            <button class="btn btn-primary w-full mt-1" onclick={openNewSpace}>
              + New space
            </button>
          </div>
        {/if}
      </div>

      <!-- search -->
      <div class="flex-1 max-w-md relative">
        <input class="input !py-1.5" placeholder="Search pages… (press Enter)" bind:value={q} onkeydown={onSearch} />
        {#if searchResults !== null}
          <div class="absolute left-0 right-0 mt-1 card shadow-xl shadow-black/50 p-2 max-h-96 overflow-y-auto">
            {#if searching}
              <div class="px-2 py-2 text-sm text-parchment-faint">Searching…</div>
            {:else if searchResults.length === 0}
              <div class="px-2 py-2 text-sm text-parchment-faint">No results.</div>
            {:else}
              {#each searchResults as r (r.space_slug + '/' + r.slug)}
                <a href="/spaces/{r.space_slug}/{r.slug}" class="block px-2 py-1.5 rounded-md hover:bg-ink-800">
                  <div class="text-sm text-parchment">{r.title}</div>
                  <div class="text-xs text-parchment-faint truncate">/{r.space_slug} — {r.snippet}</div>
                </a>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-2">
        {#if data.user}
          {#if currentSpace}
            <a href="/spaces/{currentSpace}/new" class="btn btn-primary btn-sm">+ Page</a>
          {/if}
          {#if data.user.role === 'admin'}
            <a href="/admin" class="btn btn-ghost btn-sm">Admin</a>
          {/if}
          <div class="relative">
            <button class="btn btn-ghost btn-sm" onclick={() => {
              showUserMenu = !showUserMenu;
              showSpaces = false;
            }}>
              {data.user.name} <span class="text-parchment-faint">▾</span>
            </button>
            {#if showUserMenu}
              <div class="absolute right-0 mt-1 w-52 card shadow-xl shadow-black/50 p-2">
                <div class="px-2 py-1 text-xs text-parchment-faint truncate">{data.user.email}</div>
                {#if data.user.role === 'admin'}
                  <div class="px-2 py-1"><span class="badge-admin">admin</span></div>
                {/if}
                <button
                  class="w-full text-left px-2 py-1.5 rounded-md text-sm text-parchment-dim hover:bg-ink-800 cursor-pointer"
                  onclick={doLogout}>
                  Sign out
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <a href="/login" class="btn btn-ghost btn-sm">Sign in</a>
          <a href="/register" class="btn btn-primary btn-sm">Join</a>
        {/if}
      </div>
    </div>
  </nav>

  <main class="flex-1 w-full mx-auto px-4 py-6 max-w-6xl">
    {@render children()}
  </main>

  <footer class="border-t border-ink-800 py-4">
    <div class="max-w-6xl mx-auto px-4 flex items-center justify-between text-xs text-parchment-faint">
      <span>Scriptorium — the digital scribe room</span>
      <a href="/health" class="hover:text-parchment-dim">health</a>
    </div>
  </footer>

  <!-- toasts -->
  <div class="fixed bottom-4 right-4 z-50 space-y-2 w-80">
    {#each store.toasts as t (t.id)}
      <div
        class="card px-4 py-3 text-sm shadow-lg shadow-black/40 {t.type === 'err'
          ? 'border-red-900 text-red-300'
          : 'border-emerald-900 text-emerald-300'}">
        {t.msg}
      </div>
    {/each}
  </div>

  <!-- new space dialog -->
  {#if showNewSpace}
    <div
      role="button"
      tabindex="-1"
      aria-label="Close dialog"
      class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onkeydown={(e) => e.key === 'Escape' && (showNewSpace = false)}
      onclick={() => (showNewSpace = false)}>
      <button
        aria-label="Close dialog"
        class="absolute inset-0 cursor-default"
        onclick={() => (showNewSpace = false)}
      ></button>
      <div class="card relative card w-full max-w-md p-5">
        <h2 class="text-lg font-semibold text-parchment mb-4">New space</h2>
        <div class="space-y-3">
          <div>
                        <input aria-label="Name" class="input" bind:value={ns.name} placeholder="Engineering" />
          </div>
          <div>
                        <input aria-label="Slug (optional)" class="input" bind:value={ns.slug} placeholder="engineering" />
          </div>
          <div>
                        <input aria-label="Description" class="input" bind:value={ns.description} placeholder="What is this space for?" />
          </div>
          <div>
                        <select aria-label="Visibility" class="input" bind:value={ns.visibility}>
              <option value="public">Public — anyone can read</option>
              <option value="private">Private — members only</option>
            </select>
          </div>
          {#if nsError}
            <div class="text-sm text-red-400">{nsError}</div>
          {/if}
          <div class="flex justify-end gap-2 pt-2">
            <button class="btn btn-ghost" onclick={() => (showNewSpace = false)}>Cancel</button>
            <button class="btn btn-primary" disabled={nsBusy || ns.name.trim().length < 2} onclick={createSpace}>
              {nsBusy ? 'Creating…' : 'Create space'}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>