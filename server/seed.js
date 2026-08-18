/**
 * server/seed.js — first-run bootstrap: default space + welcome page.
 * Called from the SvelteKit app when the DB is fresh (no users, no spaces).
 */

const WELCOME = `# Welcome to Scriptorium

This wiki runs on **markdown**, the good kind. Try the editor — or just read on.

> [!tip]
> Everything on this page is a feature demo. Open **Edit this page** to see the raw markdown.

## Callouts

> [!note]
> A neutral note. Good for asides.

> [!warning]
> You should be careful here — this box says so.

> [!danger]
> Absolutely do not delete the production database. You have been warned.

> [!example]
> Here is an example with a **bold** bit and a \`code\` bit inside.

### Nested callouts

> [!info]
> The outer callout.
>
> > [!tip]
> > And a nested one. Nesting is fine, any depth.

## Wikilinks

Link to other pages with double brackets: [[Getting started]] or cross-space: [[Getting started|the quickstart]].

## Writing

- ==highlighted text== works
- ~~strikethrough~~ works
- $E = mc^2$ inline math, and block math:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

- [x] task lists
- [ ] work to do
- code blocks:

\`\`\`ts
const hello = (name: string) => \`hi \${name}\`;
console.log(hello("scribe"));
\`\`\`

| Feature | Status |
|---|---|
| Spaces | done |
| Permissions | done |
| Search | done |
| This table | aligned right → |

## Next steps

1. Create a space (top-right, **+ New space**)
2. Add pages to it
3. Invite people (space → Members) — or keep it private
4. Deploy it (see the README)
`;

const GETTING_STARTED = `# Getting started

Welcome! You're either the first account on this wiki (congrats — you're **admin**)
or a newly invited member. Here's the shape of things.

## What is a space?

A **space** is a container of pages with its own access rules:

- **public** spaces are readable by anyone, even without an account
- **private** spaces are only visible to their members (and admins)

Roles inside a space, from most to least powerful:

| Role | Can… |
|---|---|
| owner / maintainer | everything, including members and space settings |
| editor | create and edit pages |
| viewer | read pages |

Admins (a global role) can do everything everywhere and manage accounts.

## Working with pages

- Every page lives at \`/<space>/<slug>\`. The slug is derived from the title on
  first save and never changes — links stay stable.
- Pages can be nested: give a page a **parent** and it appears under it in the tree.
- **History**: every save is a revision. Maintainers can browse and restore any
  older revision.
- Deleting a page is a soft delete; maintainers can restore it.

## The markdown here

This is GFM plus the Obsidian extras: callouts (\`> [!warning] …\`), wikilinks
(\`[[Page]]\`, \`[[space/Page|label]]\`), ==highlights==, $math$, task lists, and
footnotes. The full reference lives in the docs.

> [!note]
> The editor autosaves about 1.5 seconds after you stop typing. The dot in the
> top bar tells you when there are unsaved changes.
`;

/**
 * Seed a fresh database. No-ops if anything already exists.
 * @param {import('better-sqlite3').Database} db
 */
export function seed(db) {
  const hasUsers = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  const hasSpaces = db.prepare('SELECT COUNT(*) n FROM spaces').get().n > 0;
  if (hasUsers || hasSpaces) return false;

  // A seed user is required because spaces reference an owner. This account
  // is intentionally unusable (random password hash) and exists only to anchor
  // the default space; the first real registration still becomes admin.
  const owner = db.prepare(`INSERT INTO users (email, name, password_hash, role, is_seed)
    VALUES ('seed@scriptorium.local', 'Scriptorium Seed', '$argon2id$v=19$m=262144,t=3,p=4$impossiblehash$', 'user', 1)`)
    .run();

  db.prepare(`INSERT INTO spaces (slug, name, description, visibility, owner_id)
    VALUES ('main', 'Main Wiki', 'The default space — welcome page and getting started.', 'public', ?)`)
    .run(owner.lastInsertRowid);

  const space = db.prepare("SELECT * FROM spaces WHERE slug = 'main'").get();
  const now = new Date().toISOString();
  for (const [slug, title, content] of [
    ['welcome', 'Welcome', WELCOME],
    ['getting-started', 'Getting started', GETTING_STARTED]
  ]) {
    const p = db.prepare(`INSERT INTO pages (space_id, slug, title, content, rev, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, NULL, NULL, ?, ?)`).run(space.id, slug, title, content, now, now);
    db.prepare('INSERT INTO page_history (page_id, rev, content, title) VALUES (?, 1, ?, ?)').run(p.lastInsertRowid, content, title);
  }
  return true;
}