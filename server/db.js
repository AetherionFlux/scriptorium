/**
 * server/db.js — SQLite persistence for Scriptorium.
 *
 * Owns the connection, the schema (applied as versioned, additive-only
 * migrations), and the FTS5 full-text index. Everything else in the backend
 * imports from here so there is exactly one place that knows how queries
 * are shaped — that is what makes swapping in Postgres later a bounded task.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Open (and migrate) the database.
 * @param {string} dataDir  Directory that must persist; the db file lives inside it.
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'scriptorium.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Apply any pending migrations, oldest first. Migrations must be additive. */
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    });
    tx();
  }
}

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'admin'
      api_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE spaces (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
      owner_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE space_members (
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,                          -- 'viewer' | 'editor' | 'maintainer'
      PRIMARY KEY (space_id, user_id)
    );

    CREATE TABLE pages (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      rev INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (space_id, slug)
    );

    CREATE TABLE page_history (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      rev INTEGER NOT NULL,
      content TEXT NOT NULL,
      title TEXT NOT NULL,
      author_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (page_id, rev)
    );

    CREATE TABLE activity (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      space_id INTEGER REFERENCES spaces(id),
      page_id INTEGER REFERENCES pages(id),
      action TEXT NOT NULL,     -- 'page.create' | 'page.update' | 'page.delete' |
                                -- 'page.restore' | 'space.create' | 'space.update' |
                                -- 'space.delete' | 'member.add' | 'member.update' |
                                -- 'member.remove' | 'user.register'
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE password_resets (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    `
  },
  {
    version: 2,
    sql: `
    -- Full-text search over page title + content, bm25 ranked.
    -- External-content FTS5: the index is a pure index; rows are read from
    -- the real pages table by rowid, so there is nothing to duplicate.
    CREATE VIRTUAL TABLE pages_fts USING fts5(
      title,
      content,
      content='pages',
      content_rowid='id'
    );

    -- Keep the FTS index in sync with pages.
    CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;

    CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, content)
        VALUES ('delete', old.id, old.title, old.content);
    END;

    CREATE TRIGGER pages_au AFTER UPDATE OF title, content ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, content)
        VALUES ('delete', old.id, old.title, old.content);
      INSERT INTO pages_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;

    CREATE INDEX idx_pages_space ON pages(space_id, deleted_at);
    CREATE INDEX idx_activity_recent ON activity(created_at DESC);
    `
  },
  {
    version: 3,
    sql: `
    -- Marks the bootstrap placeholder account so first-real-user-becomes-admin
    -- works even though the seed space needs an owner.
    ALTER TABLE users ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;
    `
  }
];

/** Public helper: FTS5 query escaping (quotes in the input would break the query). */
export function ftsQuery(raw) {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}