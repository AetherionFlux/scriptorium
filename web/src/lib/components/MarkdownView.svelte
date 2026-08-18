<!--
  MarkdownView — renders server-produced (sanitized) HTML.
  KaTeX CSS is injected once, only when the content actually contains math.
-->
<script>
  import { onMount } from 'svelte';
  let { html = '', fallback = 'Loading…' } = $props();

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
  <div class="markdown-body" dangerouslySetInnerHTML={{ __html: html }}></div>
{:else}
  <div class="text-parchment-faint">{fallback}</div>
{/if}