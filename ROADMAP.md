# Scriptorium — Roadmap

A modern markdown wiki: SvelteKit 2 + Svelte 5 frontend, TypeScript backend, Tailwind CSS,
SQLite persistence. Public spaces, private spaces, fine-grained permissions, in-browser
editing with an Obsidian-flavored markdown dialect (callouts, wiki links), Docker image
published to GHCR by GitHub Actions, and a Helm chart for Kubernetes.

Status legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Foundations ✅

- [x] Repo scaffold: npm workspace monorepo (`web/` + shared `server/` lib)
- [x] Roadmap, architecture, markdown dialect, API, and deployment documentation
- [x] GitHub auth verified (gh + git over HTTPS)

## Phase 1 — Backend core ✅ (branch `feat/backend`)

- [x] SQLite persistence (better-sqlite3) — spaces, pages, users, memberships, activity log
- [x] Authentication: email + password (argon2id), HMAC-signed session cookies (httpOnly,
      SameSite=Lax), CSRF token double-submit, password reset tokens, API key support,
      first-visitor-becomes-admin bootstrap
- [x] Spaces API: create / rename / delete / visibility (public | private)
- [x] Pages API: hierarchy (folders), CRUD, page history, soft delete with restore
- [x] Permissions engine: role ladder `viewer < editor < maintainer < admin`;
      public read on public spaces; owner/maintainer grants; admin bypass;
      granular permission checks for every endpoint
- [x] Markdown dialect engine (shared `server/markdown.ts`): GFM + wikilinks
      `[[Page]]` / `[[space/Page]]`, Obsidian callouts (note, tip, info, warning,
      caution, danger, quote, example, failure, question, abstract, custom `> [!x]`),
      math (katex), task lists, highlight, footnotes, tables
- [x] Full-text search (SQLite FTS5, bm25)
- [x] Activity log (edits, page creates, membership changes)
- [x] Health endpoint, admin stats, user management (create/reset/delete),
      per-space membership management
- [x] Vitest unit tests for the permission engine and markdown dialect

## Phase 2 — Frontend ✅ (branch `feat/frontend`)

- [x] SvelteKit 2 (runes) + Tailwind CSS 4 (dark theme, ink/parchment palette)
- [x] In-browser editor: CodeMirror 6 (markdown syntax, markdown shortcuts, line numbers),
      Markdown / Preview / Split views, autosave with dirty-state indicator,
      callout + link templates, slug/title validation, delete & restore
- [x] Page viewer: rendered markdown with styled callout boxes, internal wiki-link
      navigation, breadcrumbs, search-as-you-type, page metadata (edited by / when)
- [x] Spaces: directory, space overview with page tree (nested), create-space dialog,
      private-space locking, per-user access panel
- [x] Auth screens: login, registration (open when no admin exists), password reset
- [x] Admin dashboard: stats, user management, activity feed
- [x] Search results page, 404 / 403 / 410 handling, responsive layout
- [x] `svelte-check` clean (0 errors / 0 warnings), production build verified,
      live end-to-end smoke test via HTTP

## Phase 3 — Packaging ✅ (branch `feat/packaging`)

- [x] Multi-stage Dockerfile (build → distroless `nodejs` runtime, non-root user),
      data persisted under `/data` (volume mount)
- [x] GitHub Actions: `ci.yaml` (lint + tests + build on every push/PR),
      `publish.yaml` (Docker layer cache → push to `ghcr.io/<owner>/scriptorium`
      on tag + main)
- [x] Helm chart `charts/scriptorium/` — Deployment, Service, PVC, Ingress (optional),
      configurable image / persistence / env, `Chart.yaml` with appVersion
- [x] Docker image built and run locally: image boots, serves UI + API on a single port

## Phase 4 — Hardening (next)

- [x] Branch-per-phase workflow, all PRs merged to `main`
- [ ] Rate limiting on auth endpoints (login, register, reset)
- [ ] Optional OIDC / SAML federation for SSO
- [ ] Import / export: bulk JSON export per space, import from Markdown folders
- [ ] Page attachments (upload, store under `/data/uploads`, signed URLs)
- [ ] Richer page metadata (tags, custom frontmatter fields, label filters)
- [ ] Audit log retention policy + JSON export
- [ ] Comments / annotations on pages
- [ ] i18n (UI localization)
- [ ] OpenAPI spec generated from the API contract
- [ ] Load-test the editor autosave path under concurrent edits (optimistic locking by revision)
- [ ] Backups: nightly dump cron in the container (opt-in) or documented kubectl procedure

## Architecture goals (standing)

1. **Single binary, single port** — the SvelteKit app serves UI *and* API, so Docker
   and Helm stay trivial; scale by replicas + a shared SQLite volume only where needed.
2. **Frontend never trusts itself** — every permission check happens server-side; the
   UI only mirrors what the API grants.
3. **The markdown dialect is a shared module** — editor, renderer, and tests all consume
   one `server/markdown.ts`, so WYSIWYG drift is impossible by construction.
4. **Deploy anywhere** — `docker run -v data:/data -p 8787:8787 ghcr.io/...` must work
   with zero configuration; Helm covers the rest.