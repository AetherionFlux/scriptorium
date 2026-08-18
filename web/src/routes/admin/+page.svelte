<!--
  /admin — global admin dashboard: stats, user management, activity feed.
  Access is enforced server-side (403 for non-admins); this page also guards
  client-side so non-admins never see the form.
-->
<script>
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { getCsrf } from '$lib/api.js';
  import { toast } from '$lib/store.svelte.js';

  const isAdmin = $derived(page.data.user?.role === 'admin');

  let stats = $state(null);
  let users = $state([]);
  let activity = $state([]);
  let tab = $state('users');
  let busy = $state(false);

  let nu = $state({ email: '', password: '', name: '', role: 'user' });

  async function load() {
    if (!isAdmin) return;
    const [s, u, a] = await Promise.all([
      fetch('/api/admin/stats'),
      fetch('/api/admin/users'),
      fetch('/api/admin/activity?limit=30')
    ]);
    stats = (await s.json()).stats ?? null;
    users = (await u.json()).users ?? [];
    activity = (await a.json()).activity ?? [];
  }
  onMount(load);

  async function call(path, method, body) {
    const r = await fetch(`/api/admin${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }

  async function createUser() {
    busy = true;
    try {
      await call('/users', 'POST', nu);
      toast('User created');
      nu = { email: '', password: '', name: '', role: 'user' };
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy = false;
    }
  }

  async function setRole(id, role) {
    try {
      await call(`/users/${id}`, 'PATCH', { role });
      toast('Role updated');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function resetPassword(id) {
    const pw = prompt(`New password for user ${id} (min 8 chars):`);
    if (!pw || pw.length < 8) return;
    try {
      await call(`/users/${id}`, 'PATCH', { password: pw });
      toast('Password reset');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function genKey(id) {
    try {
      const j = await call(`/users/${id}`, 'PATCH', { api_key: true });
      // The API returns the user without the raw key; surface a note instead.
      toast('API key regenerated (see data dir or DB for the value)', 'ok', 5000);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function delUser(id, email) {
    if (!confirm(`Delete user ${email}? Their edits remain attributed by ID.`)) return;
    try {
      await call(`/users/${id}`, 'DELETE');
      toast('User deleted');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  }
</script>

<svelte:head><title>Admin — Scriptorium</title></svelte:head>

{#if !isAdmin}
  <div class="card p-8 text-center max-w-xl mx-auto">
    <div class="text-4xl mb-3">🛡</div>
    <div class="text-parchment font-medium">Admins only</div>
    <div class="text-sm text-parchment-dim mt-1">Sign in as an administrator to view this page.</div>
  </div>
{:else}
  <div class="max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold text-parchment mb-6">Administration</h1>

    <!-- stats -->
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
      {#each [['Users', stats?.users], ['Spaces', stats?.spaces], ['Pages', stats?.pages], ['Revisions', stats?.revisions], ['Last activity', stats?.last_activity ?? '—']] as [label, value] (label)}
        <div class="card p-4">
          <div class="text-xs text-parchment-faint uppercase tracking-wider">{label}</div>
          <div class="text-xl font-bold text-parchment mt-1 truncate" title={String(value)}>{value ?? '…'}</div>
        </div>
      {/each}
    </div>

    <div class="flex gap-2 mb-4">
      <button class="btn-ghost !text-xs {tab === 'users' ? '!border-ember-600 !text-parchment' : ''}" onclick={() => (tab = 'users')}>Users</button>
      <button class="btn-ghost !text-xs {tab === 'activity' ? '!border-ember-600 !text-parchment' : ''}" onclick={() => (tab = 'activity')}>Activity</button>
    </div>

    {#if tab === 'users'}
      <div class="card p-4 mb-4 flex flex-wrap items-end gap-2">
        <div>
                    <input aria-label="Email" class="input" bind:value={nu.email} />
        </div>
        <div>
                    <input aria-label="Name" class="input" bind:value={nu.name} />
        </div>
        <div>
                    <input aria-label="Password" class="input" type="password" bind:value={nu.password} minlength="8" />
        </div>
        <div>
                    <select aria-label="Role" class="input" bind:value={nu.role}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button class="btn-primary" disabled={busy || !nu.email.includes('@') || nu.password.length < 8} onclick={createUser}>
          Create user
        </button>
      </div>

      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wider text-parchment-faint border-b border-ink-700">
            <th class="py-2 pr-2">Name</th>
            <th class="py-2 pr-2">Email</th>
            <th class="py-2 pr-2">Role</th>
            <th class="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            <tr class="border-b border-ink-800">
              <td class="py-2 pr-2 text-parchment">{u.name}</td>
              <td class="py-2 pr-2 text-parchment-dim">{u.email}</td>
              <td class="py-2 pr-2">
                <select class="input !py-1 !w-28" value={u.role} onchange={(e) => setRole(u.id, e.target.value)}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td class="py-2 text-right text-xs space-x-3 whitespace-nowrap">
                <button class="text-ember-400 hover:text-ember-300 cursor-pointer" onclick={() => resetPassword(u.id)}>reset pw</button>
                <button class="text-ember-400 hover:text-ember-300 cursor-pointer" onclick={() => genKey(u.id)}>api key</button>
                {#if u.id !== page.data.user.id}
                  <button class="text-red-400 hover:text-red-300 cursor-pointer" onclick={() => delUser(u.id, u.email)}>delete</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="card p-4">
        {#each activity as a (a.id)}
          <div class="flex items-center gap-3 py-1.5 border-b border-ink-800 text-sm">
            <span class="text-parchment-faint text-xs w-32 shrink-0">{a.created_at?.replace('T', ' ').slice(0, 16)}</span>
            <span class="badge-role shrink-0">{a.action}</span>
            <span class="text-parchment-dim flex-1 truncate">
              {a.user}{a.space ? ` @ /${a.space}` : ''}{a.page ? ` → ${a.page}` : ''}
              {a.detail ? ` · ${a.detail}` : ''}
            </span>
          </div>
        {:else}
          <div class="text-sm text-parchment-faint">No activity yet.</div>
        {/each}
      </div>
    {/if}
  </div>
{/if}