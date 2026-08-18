<!--
  /register — create an account. The first account on a fresh install becomes
  the global admin (the server decides this; the UI just hints at it).
-->
<script>
  import { goto } from '$app/navigation';
  import { refreshCsrf } from '$lib/api.js';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');

  const strong = $derived(password.length >= 8 && password === confirm);

  async function submit(e) {
    e?.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'Passwords do not match.';
      return;
    }
    busy = true;
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await refreshCsrf();
      window.dispatchEvent(new Event('scriptorium:refresh-spaces'));
      goto('/');
    } catch (e2) {
      error = e2.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Join — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-12">
  <div class="text-center mb-8">
    <div class="text-4xl mb-2">✒</div>
    <h1 class="text-xl font-bold text-parchment">Join Scriptorium</h1>
    <p class="text-sm text-parchment-dim mt-1">
      On a fresh install the first account becomes admin.
    </p>
  </div>

  <form class="card p-5 space-y-4" onsubmit={submit}>
    <div>
            <input aria-label="Name" class="input" bind:value={name} autocomplete="name" required />
    </div>
    <div>
            <input aria-label="Email" class="input" type="email" bind:value={email} autocomplete="email" required />
    </div>
    <div>
            <input aria-label="Password (min 8 chars)" class="input" type="password" bind:value={password} autocomplete="new-password" required minlength="8" />
    </div>
    <div>
            <input aria-label="Confirm password" class="input" type="password" bind:value={confirm} autocomplete="new-password" required />
    </div>
    {#if error}
      <div class="text-sm text-red-400">{error}</div>
    {/if}
    <button class="btn-primary w-full justify-center" disabled={busy || !strong}>
      {busy ? 'Creating account…' : 'Create account'}
    </button>
    <div class="text-center text-xs text-parchment-faint">
      <a href="/login" class="hover:text-parchment-dim">Already have an account? Sign in</a>
    </div>
  </form>
</div>