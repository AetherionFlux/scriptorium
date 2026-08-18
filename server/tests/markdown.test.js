/**
 * server/tests/markdown.test.js — the dialect: callouts, wikilinks, math,
 * highlight, code, and the sanitizer as the last line of defense.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown, extractCallouts, CALLOUT_TYPES } from '../markdown.js';
import { sanitizeHtml } from '../sanitize.js';

const R = (md, resolve) => renderMarkdown(md, resolve ? { resolveWikilink: resolve } : {});

describe('callouts', () => {
  it('renders a basic callout box with type + default label', () => {
    const h = R('> [!warning]\n> careful here');
    expect(h).toContain('class="callout callout-warning"');
    expect(h).toContain('callout-title">Warning</div><p>careful here</p>');
  });

  it('supports a bold inline label', () => {
    const h = R('> [!danger] **Heads up**\n> no going back');
    expect(h).toContain('callout-title">Heads up</div>');
  });

  it('renders all documented built-in types', () => {
    for (const t of CALLOUT_TYPES) {
      const h = R(`> [!${t}]\n> x`);
      expect(h, `type ${t}`).toContain(`callout-${t}`);
    }
  });

  it('renders custom types with a capitalized label', () => {
    const h = R('> [!homework]\n> do this');
    expect(h).toContain('callout-homework');
    expect(h).toContain('Homework');
  });

  it('nests callouts', () => {
    const h = R('> [!info]\n> outer\n>\n> > [!tip]\n> > inner');
    const boxes = h.match(/class="callout callout-/g) ?? [];
    expect(boxes.length).toBe(2);
    expect(h.indexOf('outer') < h.indexOf('inner')).toBe(true);
  });

  it('keeps block content inside callouts (lists, code)', () => {
    const h = R('> [!note]\n> - one\n> - two');
    expect(h).toContain('<ul>');
    expect(h).toContain('<li>one</li>');
  });

  it('does not treat callout markers inside code blocks as callouts', () => {
    const h = R('```\n> [!warning]\nnot a callout\n```');
    expect(h).not.toContain('callout-warning');
    expect(h).toContain('not a callout');
  });

  it('extractCallouts strips the > prefix from inner content', () => {
    const { blocks } = extractCallouts('> [!tip]\n> hello ==world==');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].inner).toBe('hello ==world==');
  });
});

describe('wikilinks', () => {
  const resolve = ({ name }) => {
    const ok = { 'Getting started': 'getting-started', 'Deploy': 'deploy-guide' };
    const slug = ok[name] ?? null;
    return { slug, spaceSlug: 'main', exists: !!slug };
  };

  it('resolves a local link', () => {
    const h = R('see [[Getting started]] now', resolve);
    expect(h).toContain('<a class="wikilink" href="/getting-started">Getting started</a>');
  });

  it('supports custom labels', () => {
    const h = R('[[Deploy|the guide]]', resolve);
    expect(h).toContain('href="/deploy-guide">the guide</a>');
  });

  it('marks unresolvable targets as broken', () => {
    const h = R('[[Nope]]', resolve);
    expect(h).toContain('wikilink-broken');
    expect(h).not.toContain('href=');
  });
});

describe('inline extras', () => {
  it('renders highlight', () => {
    expect(R('a ==b== c')).toContain('<mark>b</mark>');
  });
  it('renders inline math via KaTeX', () => {
    const h = R('energy $E=mc^2$ here');
    expect(h).toContain('katex');
  });
  it('renders block math in a div', () => {
    const h = R('$$\nx = 1\n$$');
    expect(h).toContain('math-block');
  });
  it('renders GFM tables and task lists', () => {
    const h = R('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(h).toContain('<table>');
    expect(h).toContain('<td>1</td>');
    const t = R('- [x] done\n- [ ] todo');
    expect(t).toContain('checked');
  });
  it('keeps code spans literal', () => {
    const h = R('`[[Getting started]]`');
    expect(h).toContain('<code>');
    expect(h).not.toContain('wikilink');
  });
});

describe('sanitizer', () => {
  it('drops script tags but keeps the text', () => {
    const h = R('<script>alert(1)<\/script>ok');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('alert');
  });
  it('strips on* handlers and javascript: URLs', () => {
    const h = sanitizeHtml('<a href="javascript:alert(1)" onclick="x()">c</a>');
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('onclick');
    expect(h).toContain('>c</a>');
  });
  it('allows http(s), mailto, and relative links', () => {
    const h = sanitizeHtml('<a href="https://x.test/y">a</a><a href="mailto:a@b.c">b</a><a href="/page">c</a>');
    expect(h).toContain('https://x.test/y');
    expect(h).toContain('mailto:a@b.c');
    expect(h).toContain('href="/page"');
  });
  it('keeps KaTeX class attributes and width styles', () => {
    const h = sanitizeHtml('<span class="katex"><span style="width:2.5em"></span></span>');
    expect(h).toContain('class="katex"');
    expect(h).toContain('style="width:2.5em"');
  });
});

describe('end to end', () => {
  it('renders a full page with every feature without crashing', () => {
    const md = [
      '# Title', '',
      '> [!warning] **Watch out**',
      '> nested ==mark== and [[Getting started]]', '',
      'math $a+b$ and', '',
      '$$',
      '\\frac{1}{2}',
      '$$', '',
      '```js',
      'let x = 1; // [[not a link]]',
      '```', '',
      '| t | t2 |',
      '|---|---|',
      '| 1 | 2 |'
    ].join('\n');
    const h = R(md, ({ name }) => ({ slug: name === 'Getting started' ? 'getting-started' : null, spaceSlug: 'main', exists: name === 'Getting started' }));
    expect(h).toContain('class="callout callout-warning"');
    expect(h).toContain('<mark>mark</mark>');
    expect(h).toContain('katex');
    expect(h).toContain('let x = 1');
    expect(h).toContain('<table>');
    expect(h).not.toContain('\x00');
  });
});