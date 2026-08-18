<!--
  404 — friendly not-found.
-->
<script>
  import { page } from '$app/state';
  let status = $derived(page.status);
</script>

<svelte:head><title>Not found — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-16 text-center">
  <div class="text-6xl mb-4">📜</div>
  <h1 class="text-xl font-bold text-parchment">This page wandered off</h1>
  <p class="text-sm text-parchment-dim mt-2">
    Nothing lives at <code class="text-ember-300">{page.url.pathname}</code>.
  </p>
  <div class="mt-6">
    <a href="/" class="btn-primary">Back to spaces</a>
  </div>
</div>