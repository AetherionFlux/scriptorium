<!--
  /login — email + password sign-in.
-->
<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { refreshCsrf } from '$lib/api.js';
  import { setUser } from '$lib/store.svelte.js';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e) {
    e?.preventDefault();
    busy = true;
    error = '';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const csrf = await refreshCsrf();
      window.dispatchEvent(new Event('scriptorium:refresh-spaces'));
      goto(page.url.searchParams.get('next') ?? '/');
    } catch (e2) {
      error = e2.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-12">
  <div class="text-center mb-8">
    <div class="text-4xl mb-2">✒</div>
    <h1 class="text-xl font-bold text-parchment">Sign in to Scriptorium</h1>
    <p class="text-sm text-parchment-dim mt-1">Your scribe credentials, please.</p>
  </div>

  <form class="card p-5 space-y-4" onsubmit={submit}>
    <div>
            <input aria-label="Email" class="input" type="email" bind:value={email} autocomplete="email" required />
    </div>
    <div>
            <input aria-label="Password" class="input" type="password" bind:value={password} autocomplete="current-password" required />
    </div>
    {#if error}
      <div class="text-sm text-red-400">{error}</div>
    {/if}
    <button class="btn-primary w-full justify-center" disabled={busy}>
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
    <div class="text-center text-xs text-parchment-faint">
      <a href="/reset" class="hover:text-parchment-dim">Forgot password?</a>
      ·
      <a href="/register" class="hover:text-parchment-dim">No account? Join</a>
    </div>
  </form>
</div>