<!--
  PageTree — collapsible page tree for a space.
  Rows are emitted depth-first; a stack tracks which depths are collapsed so
  a row is rendered only when none of its ancestors is collapsed.
  `tree`: [{slug, title, children, updated_at, ...}]
-->
<script>
  let { tree, spaceSlug, active = '' } = $props();

  let collapsed = $state(new Set());

  const flat = $derived.by(() => {
    const out = [];
    const stack = [0]; // collapsed depth of the current path (bottom = root)
    const walk = (nodes) => {
      for (const n of nodes) {
        const depth = stack.length - 1;
        // hidden only if any ancestor on the current path is collapsed —
        // equivalent: the top of the stack (innermost ancestor) is collapsed.
        if (depth > 0 && collapsed.has(stack[stack.length - 1])) return;
        out.push({ node: n, depth, hasChildren: !!n.children?.length, active: active === n.slug });
        if (n.children?.length) {
          stack.push(n.slug);
          walk(n.children);
          stack.pop();
        }
      }
    };
    walk(tree);
    return out;
  });

  function toggle(slug) {
    collapsed = new Set(collapsed.has(slug) ? [...collapsed].filter((s) => s !== slug) : [...collapsed, slug]);
  }
</script>

{#if flat.length === 0}
  <div class="text-sm text-parchment-faint px-2 py-3">No pages yet.</div>
{:else}
  <ul class="space-y-0.5">
    {#each flat as row (row.node.slug)}
      <li>
        <a
          href="/spaces/{spaceSlug}/{row.node.slug}"
          class="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-ink-800 {row.active
            ? 'bg-ink-800 text-parchment'
            : 'text-parchment-dim'}"
          style="padding-left: {8 + row.depth * 16}px">
          {#if row.hasChildren}
            <button
              class="text-parchment-faint hover:text-parchment w-4 shrink-0"
              title={collapsed.has(row.node.slug) ? 'Expand' : 'Collapse'}
              onclick={(e) => {
                e.preventDefault();
                toggle(row.node.slug);
              }}>
              {collapsed.has(row.node.slug) ? '▸' : '▾'}
            </button>
          {:else}
            <span class="w-4 inline-block shrink-0"></span>
          {/if}
          <span class="truncate text-sm flex-1">{row.node.title}</span>
          <span class="text-[10px] text-parchment-faint shrink-0"
                title="last edited {row.node.updated_at}">{row.node.updated_at?.slice(0, 10)}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}