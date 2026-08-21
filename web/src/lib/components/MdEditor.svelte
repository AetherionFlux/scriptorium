<!--
  MdEditor — CodeMirror 6 markdown editor with a template toolbar.
  Controlled: `value` flows in (load/restore), `onchange(v)` flows out.
  `templates`: [{label, title, text}] — inserts text at the cursor.
-->
<script>
  import { onMount } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder } from '@codemirror/view';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { oneDark } from '@codemirror/theme-one-dark';

  let {
    value = '',
    ph = '',
    readonly = false,
    onchange,
    templates = []
  } = $props();

  let root = $state(null);
  let view = null;
  let _external = $state(null); // last value pushed from outside

  onMount(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSelectionMatches(),
        search({ top: true }),
        indentWithTab(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        placeholder(ph || 'Write markdown…'),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-content': { padding: '12px 0', fontFamily: 'var(--font-mono)' },
          '.cm-gutters': { borderRight: '1px solid var(--color-ink-700)', background: 'transparent' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
          '&.cm-focused': { outline: 'none' }
        }),
        oneDark,
        EditorView.editable.of(() => !readonly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !readonly) {
            const v = u.state.doc.toString();
            _external = v;
            onchange?.(v);
          }
        })
      ]
    });

    view = new EditorView({ state, parent: root });
    _external = value;
    return () => view?.destroy();
  });

  // Sync external value changes (initial load, revision restore) into the view.
  $effect(() => {
    const v = value;
    if (view && v !== _external) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
      _external = v;
    }
  });

  /** Insert text at the cursor (template buttons). */
  function insert(text) {
    if (!view || readonly) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
      scrollIntoView: true
    });
    view.focus();
  }
</script>

<div class="flex flex-col h-full min-h-0">
  {#if templates.length}
    <div class="flex flex-wrap gap-1.5 border-b border-ink-700 px-2 py-1.5 bg-ink-900">
      {#each templates as t (t.label)}
        <button class="btn btn-ghost btn-sm" title={t.title} onclick={() => insert(t.text)}>
          {t.label}
        </button>
      {/each}
    </div>
  {/if}
  <div class="flex-1 min-h-0" bind:this={root}></div>
</div>