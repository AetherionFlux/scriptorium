# HTTP API Reference

Base path: `/api`. All requests are JSON unless noted. Auth is via the session
cookie (`scriptorium_session`) or the `X-Api-Key` header.

Error shape (all failures):

```json
{ "error": "human readable message", "code": "NOT_FOUND" }
```

| code | http | meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no/invalid session |
| `FORBIDDEN` | 403 | authenticated but not allowed |
| `NOT_FOUND` | 404 | resource doesn't exist (or is deleted) |
| `VALIDATION` | 400 | bad input |
| `CONFLICT` | 409 | slug exists / revision mismatch |
| `CSRF` | 403 | missing/invalid CSRF token on mutating request |

## Auth

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, name}` | creates user (first user becomes admin) |
| POST | `/auth/login` | `{email, password}` | sets session cookie |
| POST | `/auth/logout` | — | clears session |
| GET | `/auth/me` | — | current user or 401 |
| POST | `/auth/reset` | `{email}` | creates reset token (stored, not emailed in v1) |
| POST | `/auth/reset/confirm` | `{token, password}` | sets new password |

**Rate limiting** — per client IP, enforced before any auth work: `login`
20 requests / 15 min, `register` 5 / hour, `reset` + `reset/confirm` 10 / hour.
Exceeding a limit returns `429` with a `Retry-After` header. (In-memory,
per-process — move to a shared store if you run multiple replicas.)

## Spaces

| Method | Path | Notes |
|---|---|---|
| GET | `/spaces` | public + spaces the user can see |
| POST | `/spaces` | `{name, slug?, description?, visibility}` |
| GET | `/spaces/:slug` | space meta + member roles |
| PATCH | `/spaces/:slug` | maintainer+: `{name?, description?, visibility?}` |
| DELETE | `/spaces/:slug` | maintainer+ |
| GET | `/spaces/:slug/members` | maintainer+ |
| POST | `/spaces/:slug/members` | maintainer+ `{email, role}` |
| PATCH | `/spaces/:slug/members/:userId` | maintainer+ `{role?}` |
| DELETE | `/spaces/:slug/members/:userId` | maintainer+ |

## Pages

| Method | Path | Notes |
|---|---|---|
| GET | `/spaces/:slug/pages` | full tree for the space |
| GET | `/spaces/:slug/pages/:slug` | `{meta, content}` or 404 |
| POST | `/spaces/:slug/pages` | editor+ `{title, slug?, content?, parent_slug?}` |
| PUT | `/spaces/:slug/pages/:slug` | editor+ `{title?, content?, parent_slug?}` (bumps rev) |
| DELETE | `/spaces/:slug/pages/:slug` | maintainer+ or page author (soft delete) |
| POST | `/spaces/:slug/pages/:slug/restore` | maintainer+ |
| GET | `/spaces/:slug/pages/:slug/history` | list of revisions |
| GET | `/spaces/:slug/pages/:slug/history/:rev` | full revision content |
| POST | `/spaces/:slug/pages/:slug/history/:rev/restore` | editor+ (creates a new rev) |
| GET | `/spaces/:slug/pages/:slug/render` | `{html}` — server-rendered, sanitized |

## Search

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=...` | bm25-ranked, restricted to readable spaces |

## Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | users, spaces, pages, revisions, last activity |
| GET | `/admin/users` | list users with roles/spaces |
| POST | `/admin/users` | create user `{email, password, name, role?}` |
| PATCH | `/admin/users/:id` | `{name?, role?, password?}` |
| DELETE | `/admin/users/:id` | remove user (keeps authorship refs) |
| GET | `/admin/activity?limit=` | recent activity feed |
| GET | `/health` | public liveness |

## Conventions

- Mutating requests require `X-CSRF-Token` (issued per session; the client stores it
  in a JS-accessible cookie).
- `PUT` page bodies are the full new content (simple, wiki-like); optimistic
  revision checking (`rev` field, 409 on mismatch) is planned in Phase 4.
- Paginated endpoints take `limit` (default 50, max 200).