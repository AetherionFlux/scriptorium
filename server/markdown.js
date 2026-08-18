/**
 * server/markdown.js — Scriptorium's markdown dialect: one engine for renderer,
 * editor preview, and tests.
 *
 * Pipeline:
 *   1. extract fenced code blocks into placeholders   — so [[x]]/==x==/$x$ in code stays literal
 *   2. extract math ($$…$$, $…$) into placeholders
 *   3. extract top-level blockquote callouts into placeholders (nested callouts
 *      stay in the block's inner text and are handled by recursion)
 *   4. convert highlight ==…== and wikilinks [[…]]   — inline, code-safe
 *   5. marked (GFM: tables, task lists, strikethrough, footnotes, …)
 *   6. restore code blocks, math (KaTeX), callouts
 *   7. sanitize (allowlist) — user content, last line of defense
 *
 * Callouts are pre-extracted rather than handled by a marked extension because
 * they may contain ANY block markdown — including nested callouts — and a
 * one-pass indent scan over the raw lines is far more reliable than a block
 * rule. Nesting falls out for free: the outer block's inner markdown is
 * re-rendered recursively by the same pipeline.
 */
import { marked } from 'marked';
import katex from 'katex';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sanitizeHtml, escapeHtml } from './sanitize.js';

// ---------------------------------------------------------------------------
// KaTeX setup
// ---------------------------------------------------------------------------

// Resolve katex's dist files via Node's module resolution (works whether npm
// hoists node_modules to the workspace root or not).
const _req = createRequire(import.meta.url);
const KATEX_CSS = readFileSync(_req.resolve('katex/dist/katex.min.css'), 'utf8');

/** Absolute path to a katex dist font (used by the /api/katex/fonts route). */
export function katexFontPath(name) {
  return _req.resolve('katex/dist/fonts/' + name);
}

/** CSS for KaTeX — the frontend inlines it once so math needs no external assets. */
export function katexCss() {
  return KATEX_CSS;
}

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

export const CALLOUT_TYPES = [
  'note', 'info', 'tip', 'success', 'question', 'warning',
  'caution', 'failure', 'danger', 'example', 'quote', 'abstract'
];

const CALLOUT_ICONS = {
  note: '📝', info: 'ℹ️', tip: '💡', success: '✅', question: '❓',
  warning: '⚠️', caution: '⚠️', failure: '❌', danger: '🚨',
  example: '📖', quote: '❝', abstract: '🧾'
};

const CALLOUT_LABELS = {
  note: 'Note', info: 'Info', tip: 'Tip', success: 'Success', question: 'Question',
  warning: 'Warning', caution: 'Caution', failure: 'Failure', danger: 'Danger',
  example: 'Example', quote: 'Quote', abstract: 'Abstract'
};

/**
 * Extract TOP-LEVEL callout blocks from raw markdown.
 *
 * A callout starts at a line matching `> [!type] optional label` and runs
 * through subsequent `>`-prefixed lines (blank lines belong to the block while
 * a later non-blank line still starts with `>`, per markdown blockquote
 * continuation). Inner (nested) callouts stay in `inner`; they are processed
 * recursively when the block is rendered.
 *
 * @returns {{text: string, blocks: Array<{type: string, label: string, inner: string}>}}
 *   `text` has `\x00CO<n>\x00` placeholders in document order.
 */
export function extractCallouts(md) {
  const lines = md.split('\n');
  const out = [];
  const blocks = [];
  const startRe = /^(\s*)>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/;

  let i = 0;
  while (i < lines.length) {
    const m = startRe.exec(lines[i]);
    if (!m) { out.push(lines[i]); i++; continue; }

    const type = m[2].toLowerCase();
    const label = m[3].trim().replace(/^\*\*(.+?)\*\*$/, '$1');
    const indent = m[1].length; // column of this callout's quote marker

    // A *sibling* marker: exactly one `>` at this callout's indent, then `[!`.
    // (`> > [!x]` is NESTED — one extra quote level — and belongs to this block.)
    const siblingMarker = (line) =>
      line.match(/^\s*/)[0].length === indent && /^\s*> ?\[!/.test(line);

    // Find the end of the blockquote block.
    let end = i + 1;
    while (end < lines.length) {
      const ln = lines[end];
      if (ln.trim() === '') {
        // A blank line continues the callout only when the next quote line is
        // a continuation of this callout — not a sibling `[!type]` marker (a
        // new callout) and not at a different indent (a different block).
        let j = end + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length) {
          const nxt = lines[j];
          const nxtIndent = nxt.match(/^\s*/)[0].length;
          if (nxt.trimStart().startsWith('>') && nxtIndent === indent && !siblingMarker(nxt)) {
            end++;
            continue;
          }
        }
        break;
      }
      if (ln.trimStart().startsWith('>')) {
        if (siblingMarker(ln)) break; // a new sibling callout ends this block
        end++;
        continue;
      }
      break;
    }

    // Strip the `> ` prefix (and one optional space) from each line.
    // The first line's marker (`> [!type] label`) itself is dropped — the
    // label is captured separately and rendered as the callout title.
    const innerLines = lines
      .slice(i, end)
      .map((ln) => (ln.trim() === '' ? '' : ln.replace(/^(\s*)>\s?/, '$1')));
    innerLines[0] = ''; // marker line -> empty (label handled by the title)
    const inner = innerLines.join('\n').replace(/^\n+|\n+$/g, '');

    blocks.push({ type, label, inner });
    out.push(`\x00CO${blocks.length - 1}\x00`);
    i = end;
  }
  return { text: out.join('\n'), blocks };
}

/** Render callout placeholders back into styled boxes. */
function renderCalloutHtml(html, blocks, renderInner) {
  let out = html;
  for (const b of blocks) {
    const icon = CALLOUT_ICONS[b.type] ?? '✳️';
    const label = b.label ? escapeHtml(b.label) : escapeHtml(CALLOUT_LABELS[b.type] ?? cap(b.type));
    const box =
      `<div class="callout callout-${escapeHtml(b.type)}" data-callout="${escapeHtml(b.type)}">` +
      `<div class="callout-marker">${icon}</div>` +
      `<div class="callout-body"><div class="callout-title">${label}</div>${renderInner(b.inner)}</div></div>`;
    out = out.split(`\x00CO${blocks.indexOf(b)}\x00`).join(box);
  }
  return out;
}

const cap = (s) => s.replace(/(^|[-_ ])(\w)/g, (_, a, b) => a + b.toUpperCase());

// ---------------------------------------------------------------------------
// Math & code extraction
// ---------------------------------------------------------------------------

/** Pull fenced code blocks into placeholders. */
function extractCode(md) {
  const codes = [];
  const out = md.replace(/(^|\n)(```+|~~~+)([^\n]*)\n([\s\S]*?)\n\2([^\n]*)/g, (_m, pre, _fence, info, body) => {
    codes.push({ info: info.trim(), body });
    return `${pre}\x00CODE${codes.length - 1}\x00`;
  });
  return { text: out, codes };
}

/** Pull math into placeholders ($$ block first, then $ inline). */
function extractMath(md) {
  const math = [];
  let text = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
    math.push({ block: true, tex });
    return `\x00MATH${math.length - 1}\x00`;
  });
  text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$(?!\$)/g, (m, pre, tex) => {
    math.push({ block: false, tex });
    return `${pre}\x00MATH${math.length - 1}\x00`;
  });
  return { text, math };
}

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

/**
 * Convert [[Target]] / [[space/Target]] / [[Target|label]] to anchor markup.
 * `resolve({spaceSlug, name})` must return `{slug, spaceSlug, exists}` —
 * injected by the API so this engine stays db-free.
 */
export function convertWikilinks(md, resolve) {
  return md.replace(/\[\[([^\]\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (m, target, label) => {
    const t = target.trim();
    let spaceSlug = null;
    let name = t;
    if (t.includes('/')) {
      const i = t.indexOf('/');
      spaceSlug = t.slice(0, i).trim();
      name = t.slice(i + 1).trim();
    }
    const r = resolve ? resolve({ spaceSlug, name }) : { slug: null, exists: false };
    const text = label ?? name;
    // Local target: slug-only href. Cross-space target: keep the space prefix.
    const href = r.slug ? (spaceSlug ? `/${spaceSlug}/${r.slug}` : `/${r.slug}`) : null;
    if (href) return `<a class="wikilink" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
    return `<a class="wikilink wikilink-broken" title="Page not found" aria-disabled="true">${escapeHtml(text)}</a>`;
  });
}

// ---------------------------------------------------------------------------
// Block render (recursive for callout nesting)
// ---------------------------------------------------------------------------

/**
 * Full pipeline for one markdown chunk (no sanitizing — the top-level call
 * sanitizes the final document once).
 */
function renderBlock(md, opts) {
  const code = extractCode(md);
  const math = extractMath(code.text);
  const co = extractCallouts(math.text);

  const spans = extractCodeSpans(co.text);
  let s = spans.text;
  s = s.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
  s = convertWikilinks(s, opts.resolveWikilink);
  let h = marked.parse(s, { gfm: true, breaks: false });
  h = restoreCodeSpans(h, spans.codes);

  // Marked wraps lone placeholder lines in <p>; unwrap so restored blocks
  // (pre/div) sit at the top level instead of producing <p><pre>…</pre></p>.
  h = h.replace(/<p>\s*\x00(CO|MATH|CODE)(\d+)\x00\s*<\/p>/g, (_m, kind, i) => `\x00${kind}${i}\x00`);

  h = renderCalloutHtml(h, co.blocks, (inner) => renderBlock(inner, opts));
  h = restoreCode(h, code.codes);
  h = restoreMath(h, math.math);
  return h;
}

/** Pull inline code spans (`x` / ``x``) into placeholders so inline
 *  conversions (wikilinks, highlights) never touch their contents. */
function extractCodeSpans(md) {
  const codes = [];
  const out = md.replace(/(`{1,2})([^`\n]|\.(?!`))*?\1/g, (m2, fence, body) => {
    codes.push(body);
    return `\x00SPAN${codes.length - 1}\x00`;
  });
  return { text: out, codes };
}

function restoreCodeSpans(html, codes) {
  return html.replace(/\x00SPAN(\d+)\x00/g, (_m, i) => `<code>${escapeHtml(codes[Number(i)] ?? '')}</code>`);
}

function restoreCode(html, codes) {
  return html.replace(/\x00CODE(\d+)\x00/g, (_m, i) => {
    const c = codes[Number(i)];
    if (!c) return '';
    const lang = c.info.split(/\s+/)[0] || 'text';
    return `<pre class="code-block" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(c.body)}</code></pre>`;
  });
}

function restoreMath(html, math) {
  return html.replace(/\x00MATH(\d+)\x00/g, (_m, i) => {
    const x = math[Number(i)];
    if (!x) return '';
    try {
      const out = katex.renderToString(x.tex, { displayMode: x.block, throwOnError: false, output: 'html' });
      return x.block ? `<div class="math-block">${out}</div>` : out;
    } catch {
      return `<code>${escapeHtml(x.tex)}</code>`;
    }
  });
}

/**
 * Render Scriptorium markdown to sanitized HTML.
 * @param {string} md
 * @param {object} [opts]
 * @param {(t: {spaceSlug: string|null, name: string}) => {slug: string|null, spaceSlug?: string|null, exists: boolean}} [opts.resolveWikilink]
 * @returns {string} HTML safe to inject into the page.
 */
export function renderMarkdown(md, opts = {}) {
  return sanitizeHtml(renderBlock(md ?? '', opts));
}

export { marked };