<!--
  /reset — v1 password reset without SMTP.
  Step 1: request a token for your email (returned here for the operator).
  Step 2: confirm with token + new password.
-->
<script>
  import { goto } from '$app/navigation';
  import { refreshCsrf } from '$lib/api.js';

  let email = $state('');
  let token = $state('');
  let newPassword = $state('');
  let busy = $state(false);
  let error = $state('');
  let issued = $state('');

  async function requestToken(e) {
    e?.preventDefault();
    busy = true;
    error = '';
    issued = '';
    try {
      const r = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.token) {
        issued = j.token;
        token = j.token;
      } else {
        error = 'No account found for that email.';
      }
    } catch (e2) {
      error = e2.message;
    } finally {
      busy = false;
    }
  }

  async function confirm(e) {
    e?.preventDefault();
    busy = true;
    error = '';
    try {
      const r = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: newPassword })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await refreshCsrf();
      goto('/login');
    } catch (e2) {
      error = e2.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Reset password — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-12 space-y-4">
  <div class="text-center">
    <h1 class="text-xl font-bold text-parchment">Reset password</h1>
    <p class="text-sm text-parchment-dim mt-1">
      v1 has no SMTP: the reset token is shown here for the operator to use.
    </p>
  </div>

  <form class="card p-5 space-y-4" onsubmit={requestToken}>
    <div>
            <input aria-label="Account email" class="input" type="email" bind:value={email} required />
    </div>
    <button class="btn-primary w-full justify-center" disabled={busy || !email.includes('@')}>
      Issue reset token
    </button>
  </form>

  {#if issued}
    <form class="card p-5 space-y-4 border-ember-600/40" onsubmit={confirm}>
      <div>
        <div class="text-xs text-parchment-dim mb-1">Reset token (one hour)</div>
        <code class="block bg-ink-950 rounded p-2 text-xs break-all text-ember-300">{issued}</code>
      </div>
      <div>
                <input aria-label="New password (min 8 chars)" class="input" type="password" bind:value={newPassword} required minlength="8" />
      </div>
      <button class="btn-primary w-full justify-center" disabled={busy || newPassword.length < 8}>
        Set new password
      </button>
    </form>
  {/if}

  {#if error}
    <div class="text-sm text-red-400 text-center">{error}</div>
  {/if}
</div>