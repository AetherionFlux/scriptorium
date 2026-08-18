<!--
  /health — liveness probe (rendered, not JSON — the JSON version is /api/health).
-->
<script>
  import { onMount } from 'svelte';
  let ok = $state(false);
  let time = $state('');
  onMount(async () => {
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      ok = j.ok;
      time = j.time;
    } catch {
      ok = false;
    }
  });
</script>

<svelte:head><title>Health — Scriptorium</title></svelte:head>

<div class="max-w-sm mx-auto mt-16 text-center">
  <div class="text-4xl mb-3">{ok ? '✅' : '❌'}</div>
  <h1 class="text-lg font-semibold text-parchment">{ok ? 'Scriptorium is healthy' : 'Unhealthy'}</h1>
  {#if time}<p class="text-xs text-parchment-faint mt-2">server time: {time}</p>{/if}
</div>