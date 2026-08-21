<!--
  / — space directory. Lists every space the current user may see.
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let spaces = $state(null); // null = loading
  let error = $state('');

  async function load() {
    error = '';
    try {
      const r = await fetch('/api/spaces');
      const j = await r.json();
      spaces = j.spaces ?? [];
    } catch (e) {
      error = e.message;
    }
  }
  onMount(load);
  load(); // SSR pass for the shell

  function openNewSpace() {
    window.dispatchEvent(new Event('scriptorium:new-space'));
  }
</script>

<svelte:head><title>Spaces — Scriptorium</title></svelte:head>

<div class="max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-parchment">Spaces</h1>
      <p class="text-sm text-parchment-dim mt-1">
        A space is a container of pages with its own access rules.
      </p>
    </div>
    {#if page.data.user}
      <button class="btn btn-primary" onclick={openNewSpace}>+ New space</button>
    {:else}
      <span class="text-xs text-parchment-faint">Sign in to create spaces</span>
    {/if}
  </div>

  {#if error}
    <div class="card p-4 text-sm text-red-400">{error}</div>
  {:else if spaces === null}
    <div class="text-parchment-faint">Loading…</div>
  {:else if spaces.length === 0}
    <div class="card p-8 text-center">
      <div class="text-4xl mb-3">📜</div>
      <div class="text-parchment font-medium mb-1">No spaces yet</div>
      <div class="text-sm text-parchment-dim mb-4">Create the first one to start writing.</div>
      {#if page.data.user}
        <button class="btn btn-primary" onclick={openNewSpace}>Create a space</button>
      {/if}
    </div>
  {:else}
    <div class="grid sm:grid-cols-2 gap-3">
      {#each spaces as s (s.slug)}
        <a href="/spaces/{s.slug}" class="card p-4 hover:border-ember-600/60 transition-colors block">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-parchment">{s.name}</span>
            {#if s.visibility === 'private'}
              <span class="badge-private">private</span>
            {:else}
              <span class="badge-public">public</span>
            {/if}
          </div>
          <div class="text-sm text-parchment-dim line-clamp-2">
            {s.description || 'No description.'}
          </div>
          <div class="text-[11px] text-parchment-faint mt-2">/{s.slug}</div>
        </a>
      {/each}
    </div>
  {/if}
</div>