<!--
  SpaceSettings — maintainer settings dialog content (name, description,
  visibility, danger zone: delete space).
-->
<script>
  import { goto } from '$app/navigation';
  import { getCsrf } from '$lib/api.js';
  import { toast } from '$lib/store.svelte.js';

  let { space, ondone } = $props();

  let form = $state(null);
$effect(() => {
  // Seed the form once from the (possibly reactive) space prop.
  if (form === null) form = { name: space.name, description: space.description, visibility: space.visibility };
});
  let busy = $state(false);
  let error = $state('');

  async function patch(body) {
    const r = await fetch(`/api/spaces/${space.slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() ?? '' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }

  async function save() {
    busy = true;
    error = '';
    try {
      const j = await patch(form);
      toast('Space updated');
      ondone?.();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function del() {
    if (!confirm(`Delete the space "${space.name}" and ALL its pages? This cannot be undone.`)) return;
    busy = true;
    error = '';
    try {
      const r = await fetch(`/api/spaces/${space.slug}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': getCsrf() ?? '' }
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      toast('Space deleted');
      goto('/');
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<div>
  <h2 class="text-lg font-semibold text-parchment mb-4">Space settings</h2>
  <div class="space-y-3">
    <div>
            <input aria-label="Name" class="input" bind:value={form.name} />
    </div>
    <div>
            <input aria-label="Description" class="input" bind:value={form.description} />
    </div>
    <div>
            <select aria-label="Visibility" class="input" bind:value={form.visibility}>
        <option value="public">Public — anyone can read</option>
        <option value="private">Private — members only</option>
      </select>
    </div>
    {#if error}
      <div class="text-sm text-red-400">{error}</div>
    {/if}
    <div class="flex items-center justify-between pt-2">
      <button class="btn btn-danger" onclick={del}>Delete space…</button>
      <button class="btn btn-primary" disabled={busy} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </div>
</div>