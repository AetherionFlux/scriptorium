# Scriptorium Markdown Dialect

Scriptorium renders a superset of GitHub Flavored Markdown (GFM) plus the
Obsidian-style extras users expect from a notes tool. One engine
(`server/markdown.ts`) renders both the API and the tests, so what you see in the
preview is exactly what is stored and served.

## Callouts (the "boxed" notes)

Obsidian-style callouts, typed and colored:

```markdown
> [!note]
> A neutral note.

> [!tip]
> You should really try this.

> [!warning]
> Careful — this will overwrite your data.

> [!danger]
> This deletes everything. No undo.
```

Built-in types (each gets its own color + icon):

| Type | Intent |
|---|---|
| `note` | neutral annotation |
| `info` | FYI |
| `tip` | helpful suggestion |
| `success` | things went well |
| `question` | open question |
| `warning` | be careful |
| `caution` | risky operation |
| `failure` | something broke |
| `danger` | destructive |
| `example` | example |
| `quote` | citation |
| `abstract` | summary |

Custom types: `> [!mytype]` renders as a generic styled box with the type name in the
label. An optional bold title follows: `> [!warning] **Heads up**`.

Callouts are nestable to any depth (each nesting level shifts the border style).

## Wikilinks

```markdown
[[Getting started]]            → link to "Getting started" in the current space
[[dev/Deploy guide]]           → link to "Deploy guide" in space "dev" (path form)
[[Getting started|read this]]  → custom link text
```

The renderer resolves slugs server-side against the page tree; unresolvable links
render as dimmed "broken" pills so readers can see the intended target.

## Other extensions (over GFM)

- `==highlight==` → `<mark>`
- Math: `$inline$` and `$$block$$` → KaTeX
- Footnotes: `[^1]: text`
- Task lists: `- [ ]` / `- [x]`
- Tables with alignment (GFM)
- Strikethrough `~~text~~` (GFM)

## Authoring conventions

- **Slug = URL path.** A page's slug is derived from its title on first save
  (`Deploy guide` → `deploy-guide`). Slugs are stable; renaming a title does not
  move the page.
- **Folders** are just pages with children; the editor's "parent" dropdown mirrors
  the tree.
- **Autosave** fires 1.5s after the last keystroke (and on blur / nav-away);
  every successful save appends to page history.