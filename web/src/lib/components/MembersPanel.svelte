<!--
  MembersPanel — space membership management (maintainers).
-->
<script>
  import { getCsrf } from '$lib/api.js';
  import { toast } from '$lib/store.svelte.js';

  let { spaceSlug, members, ondone } = $props();

  let invite = $state({ email: '', role: 'editor' });
  let busy = $state(false);
  let error = $state('');

  async function call(path, method, body) {
    const r = await fetch(`/api/spaces/${spaceSlug}/members${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }

  async function add() {
    busy = true;
    error = '';
    try {
      await call('', 'POST', invite);
      invite = { email: '', role: 'editor' };
      toast('Member added');
      ondone?.();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function setRole(userId, role) {
    try {
      await call(`/${userId}`, 'PATCH', { role });
      toast('Role updated');
      ondone?.();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function remove(userId) {
    if (!confirm('Remove this member?')) return;
    try {
      await call(`/${userId}`, 'DELETE');
      toast('Member removed');
      ondone?.();
    } catch (e) {
      toast(e.message, 'err');
    }
  }
</script>

<div>
  <h2 class="text-lg font-semibold text-parchment mb-4">Members</h2>

  <div class="card p-3 mb-4 flex flex-wrap items-end gap-2">
    <div class="flex-1 min-w-40">
            <input aria-label="Invite by email" class="input" bind:value={invite.email} placeholder="person@example.com" />
    </div>
    <div>
            <select aria-label="Role" class="input" bind:value={invite.role}>
        <option value="viewer">viewer</option>
        <option value="editor">editor</option>
        <option value="maintainer">maintainer</option>
      </select>
    </div>
    <button class="btn-primary" disabled={busy || !invite.email.includes('@')} onclick={add}>Add</button>
  </div>

  {#if error}
    <div class="text-sm text-red-400 mb-3">{error}</div>
  {/if}

  <table class="w-full text-sm">
    <thead>
      <tr class="text-left text-xs uppercase tracking-wider text-parchment-faint border-b border-ink-700">
        <th class="py-2 pr-2">Name</th>
        <th class="py-2 pr-2">Email</th>
        <th class="py-2 pr-2">Role</th>
        <th class="py-2"></th>
      </tr>
    </thead>
    <tbody>
      {#each members ?? [] as m (m.user_id)}
        <tr class="border-b border-ink-800">
          <td class="py-2 pr-2 text-parchment">{m.name}</td>
          <td class="py-2 pr-2 text-parchment-dim">{m.email}</td>
          <td class="py-2 pr-2">
            <select
              class="input !py-1 !w-32"
              value={m.role}
              onchange={(e) => setRole(m.user_id, e.target.value)}
              disabled={m.role === 'owner'}>
              {#if m.role === 'owner'}
                <option value="owner">owner</option>
              {:else}
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="maintainer">maintainer</option>
              {/if}
            </select>
          </td>
          <td class="py-2 text-right">
            {#if m.role !== 'owner'}
              <button class="text-red-400 hover:text-red-300 text-xs cursor-pointer" onclick={() => remove(m.user_id)}>
                remove
              </button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>