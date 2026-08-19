<!--
  Error page — status-aware. SvelteKit routes thrown error(status, msg) here,
  so 404 (missing) and 403 (no access) render distinct messages with the
  correct HTTP status. Uses {@html} (the node directive compiles to a real
  innerHTML assignment and renders on the server, so crawlers/monitoring see
  the message in the HTML, not just after hydration).
-->
<script>
  import { page } from '$app/state';
  let status = $derived(page.status);
  let is403 = $derived(status === 403);
  let is5xx = $derived(status >= 500);
  let emoji = $derived(is403 ? '🔒' : is5xx ? '⚠️' : '📜');
  let heading = $derived(is403 ? 'You cannot see this' : is5xx ? 'Something broke' : 'This page wandered off');
  let msg = $derived(
    is403
      ? 'You are signed in, but this space or page is not one you can access. Ask a maintainer for membership.'
      : is5xx
        ? 'The server hit an unexpected error. Nothing was changed — try again in a moment.'
        : `Nothing lives at <code class="text-ember-300">${page.url.pathname}</code>. It may have been deleted or renamed.`
  );
</script>

<svelte:head><title>{status} — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-16 text-center">
  <div class="text-6xl mb-4">{emoji}</div>
  <h1 class="text-xl font-bold text-parchment">{heading}</h1>
  <p class="text-sm text-parchment-dim mt-2">{@html msg}</p>
  <div class="mt-6">
    <a href="/" class="btn-primary">Back to spaces</a>
  </div>
</div>