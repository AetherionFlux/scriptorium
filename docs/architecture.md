# Architecture

## Overview

```
                 ┌────────────────────────────────────────────────┐
                 │            Node.js process (one port)          │
   browser ────► │  SvelteKit (SSR) ──► /api/* ──► server/api.ts  │
                 │            │                          │        │
                 │            │                  ┌──────────────┐ │
                 │            │                  │ permission   │ │
                 │            ▼                  │ engine       │ │
                 │      rendered HTML            │ (roles,      │ │
                 │                               │  spaces,     │ │
                 │                               │  admin)      │ │
                 │            ┌──────────────────┼────────────┐ │
                 │            ▼                  ▼            ▼ │
                 │        markdown.ts ──► better-sqlite3      │ │
                 │        (shared dialect)  (SQLite + FTS5)   │ │
                 │                               │            │ │
                 └───────────────────────────────┼────────────┘ │
                                                 ▼
                                        /data (volume)
```

One process, one port. SvelteKit serves both the UI (SSR + hydration) and the JSON
API under `/api/*` (via SvelteKit `+server.js` route handlers). This keeps Docker and
Helm trivial: no reverse proxy between services, no CORS, no two-image coordination.

## Modules

### `server/` — framework-agnostic core

The entire backend logic is written without importing any framework (no Hono, no
Express). It exposes plain functions that take a `ctx` object
(`{ user, db, url }`) and return `{ status, body }`. The SvelteKit layer is a thin
adapter that reads the session cookie, builds `ctx`, and forwards the response.

| File | Responsibility |
|---|---|
| `db.ts` | SQLite connection, schema, migrations (versioned `schema_migrations` table), FTS5 setup |
| `auth.ts` | argon2id hashing, HMAC-signed session cookies (httpOnly, SameSite=Lax), CSRF double-submit, password-reset tokens, API keys |
| `permissions.ts` | Role ladder, `can(user, action, space)` checks — the single source of truth for access control |
| `markdown.ts` | Markdown → HTML engine: GFM, wikilinks, callouts, math, task lists; shared by renderer, tests, and (future) editor preview |
| `api.ts` | All endpoint handlers: spaces, pages, history, search, users, admin, activity |
| `seed.ts` | First-run bootstrap: default space, welcome page |

### `web/` — SvelteKit frontend

- `src/routes/+server.js` under `/api/*`: thin adapters that parse the request, build
  `ctx` via `server/auth.ts`, and return what `server/api.ts` produced.
- `src/routes/+layout.svelte`: shell (nav, auth state, toasts), Tailwind entry.
- Page routes: `/` (space directory), `/[space]` (space overview + page tree),
  `/[space]/[...slug]` (viewer), `/edit/[space]/[...slug]` (editor),
  `/search`, `/admin`, `/login`, `/register`, `/reset`.
- `src/lib/editor/`: CodeMirror 6 setup (markdown language, shortcuts), autosave logic.
- `src/lib/components/`: MarkdownView (renders API-provided HTML, sanitized server-side),
  PageTree, CalloutTemplateMenu, AccessPanel, etc.

### Data model (SQLite)

```
users(id, email, name, password_hash, role, api_key, created_at)
spaces(id, slug, name, description, visibility, owner_id, created_at)
space_members(space_id, user_id, role)            -- maintainer/editor/viewer grants
pages(id, space_id, slug, title, content, parent_id, rev, deleted_at,
      created_by, created_at, updated_by, updated_at)
page_history(page_id, rev, content, author_id, created_at)
activity(id, user_id, space_id, page_id, action, detail, created_at)
password_resets(token, user_id, expires_at, used)
schema_migrations(version, applied_at)
pages_fts (FTS5 virtual table, shadow of pages.title+content)
```

## Permission model

Role ladder (higher wins, checked from the top):

1. **admin** (global, `users.role`) — everything.
2. **owner / maintainer** (per space) — manage space, members, delete any page.
3. **editor** (per space) — create/edit pages.
4. **viewer** (per space) — read.
5. **anonymous** — read on `visibility='public'` spaces only.

Rules, enforced in `can()` in `server/permissions.ts`:

- Reading a page requires read access to its space (or public visibility).
- Editing requires editor+ in that space.
- Space create: any authenticated user (becomes owner).
- Space delete / visibility change / member management: maintainer+ or admin.
- User management: admin only.

The frontend never gates a request based on client state — it only hides UI.
Every `/api` call re-checks permissions against the live DB row.

## Markdown dialect

Implemented once in `server/markdown.ts` (shared by API and tests). See
[markdown.md](markdown.md). Rendering is server-side in the API (`/api/pages/.../render`),
so the browser receives sanitized HTML — no client-side parser, no XSS surface from
content.

## Security notes

- Passwords: argon2id (memory 256MB, 3 iterations, parallelism 4).
- Sessions: 64-byte random id, HMAC-SHA256 signature with server secret
  (`SESSION_SECRET`, auto-generated and persisted in the data dir on first boot).
- CSRF: `X-CSRF-Token` header must match a value tied to the session (double-submit).
- Markdown output is escaped then allowlisted (no `on*` attributes, no `javascript:` URLs).
- API keys: `X-Api-Key` header, random 32-byte hex, revocable per user.
- The data dir is the only state. Wipe it, wipe the wiki.

## Scaling story (honest)

SQLite is a single-writer store. This is *fine* for a wiki up to a few concurrent
editors (WAL mode + short transactions). Beyond that, the options are:

1. Stick to one replica (recommended; a wiki's write volume is tiny).
2. Replace `db.ts` with a Postgres-compatible driver (the query layer is isolated
   there) and run a `pgbouncer` in front — not done, tracked in the roadmap.