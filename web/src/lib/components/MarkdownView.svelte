<!--
  MarkdownView — renders server-produced (sanitized) HTML.
  KaTeX CSS is injected once, only when the content actually contains math.

  NOTE: we set the innerHTML property through a node ref. Svelte 5.56.9 compiles
  the `innerHTML={...}` attribute to a lowercase set_attribute ("innerhtml"),
  which lands as an inert HTML attribute instead of the DOM property — leaving
  the body blank. Binding a ref and assigning el.innerHTML sidesteps that.
-->
<script>
  import { onMount } from 'svelte';
  let { html = '', fallback = 'Loading…' } = $props();

  let node = $state(null);
  $effect(() => {
    // Track the html string so the effect re-runs on change.
    const value = html;
    if (node) node.innerHTML = value;
  });

  const needsKatex = (s) => /class="katex"/.test(s);
  let katexCssLoaded = $state(false);
  onMount(() => {
    if (needsKatex(html)) katexCssLoaded = true;
  });
</script>

{#if katexCssLoaded}
  <link rel="stylesheet" href="/api/katex.css" />
{/if}

{#if html}
  <div class="markdown-body" bind:this={node}></div>
{:else}
  <div class="text-parchment-faint">{fallback}</div>
{/if}