/**
 * server/sanitize.js — allowlist HTML sanitizer for rendered markdown.
 *
 * The markdown pipeline (marked + katex + our own extensions) emits HTML that is
 * mostly trusted, but page content is user input, so the final HTML passes
 * through this filter before it is ever served to a browser:
 *
 *  - only allowlisted tags survive (everything else is dropped, text kept);
 *  - attributes are filtered per-tag; only `class` is allowed globally
 *    (KaTeX output requires it);
 *  - `href`/`src` must be http(s), mailto, relative, fragment, or data:image;
 *  - comments, doctypes, and any `javascript:`/`vbscript:` URLs are stripped.
 *
 * It is a tokenizer (not regex-replace), so nested tags cannot smuggle a
 * disallowed tag past the filter.
 */

const ALLOWED_TAGS = new Set([
  // text & flow
  'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'span', 'div',
  'ul', 'ol', 'li', 'a', 'em', 'strong', 'del', 'ins', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // misc
  'input', 'sup', 'sub', 'img', 'figure', 'figcaption', 'details', 'summary',
  // KaTeX MathML
  'math', 'maction', 'mannotation', 'menclose', 'mfrac', 'mi', 'mmultiscripts',
  'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mroot', 'mrow', 'ms', 'mspace',
  'msqrt', 'msup', 'msub', 'msupsub', 'mtable', 'mtd', 'mtext', 'mtr', 'munder',
  'munderover', 'semantics'
]);

const VOID = new Set(['br', 'hr', 'img', 'input']);

/** Per-tag attribute allowlists (class is added for every tag in the loop below). */
const TAG_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'checked', 'disabled', 'readonly', 'value'],
  ol: ['start'],
  td: ['align'],
  th: ['align'],
  code: []
};

/** KaTeX emits `style="width:…"` on mspace; allow only that narrow shape. */
const SAFE_MATH_STYLE = /^width:\s*[\d.]+(em|ex|mu|pt)?;?$/i;

/** MathML tags may carry any attribute except event handlers. */
const isMathTag = (t) => t === 'math' || /^m[a-z]+$/.test(t) || t === 'semantics';

const URL_ATTRS = new Set(['href', 'src']);

function safeUrl(value, attr) {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text')) return false;
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) return true;
  if (lower.startsWith('#') || lower.startsWith('/') || lower.startsWith('./') || lower.startsWith('../')) return true;
  if (attr === 'src' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(lower)) return true;
  if (!lower.includes(':')) return true; // protocol-relative-ish / bare path
  return false;
}

/** Parse the attribute portion of a tag into [name, rawValue] pairs. */
function parseAttrs(str) {
  const attrs = [];
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
    attrs.push([name, value]);
  }
  return attrs;
}

/**
 * Sanitize an HTML string.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  let out = '';
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|\?[^>]*\?|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    const tok = m[0];
    if (tok[0] !== '<') {
      out += tok; // text node (already escaped by the markdown pipeline)
      continue;
    }
    const tagRe = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>$/;
    const tm = tagRe.exec(tok);
    if (!tm) continue;
    const closing = tm[1] === '/';
    const tag = tm[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue; // drop disallowed tags entirely
    if (closing) {
      out += `</${tag}>`;
      continue;
    }
    // Sanitize attributes.
    let attrStr = '';
    for (const [name, value] of parseAttrs(tm[3] ?? '')) {
      if (name.startsWith('on')) continue;
      const allowed =
        name === 'class' ||
        TAG_ATTRS[tag]?.includes(name) ||
        (isMathTag(tag) && (name === 'style' ? SAFE_MATH_STYLE.test(value) : true));
      if (!allowed) continue;
      if (URL_ATTRS.has(name) && !safeUrl(value, name)) continue;
      attrStr += value === '' && VOID.has(tag) === false && ['checked', 'disabled'].includes(name)
        ? ` ${name}`
        : ` ${name}="${value.replace(/"/g, '&quot;')}"`;
    }
    out += `<${tag}${attrStr}${VOID.has(tag) ? ' /' : ''}>`;
  }
  return out;
}

/** Escape a string for safe inclusion in HTML text. */
export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escape a string for use inside a double-quoted HTML attribute. */
export function escapeAttr(s) {
  return escapeHtml(s);
}