import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

const DEFAULT_DB_PATH = process.env.GITDASH_DB
  ?? path.join(process.env.HOME ?? ".", ".local", "state", "gitdash", "gitdash.sqlite");

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  const dbPath = DEFAULT_DB_PATH;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  instance = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_path         TEXT NOT NULL UNIQUE,
      git_dir_path      TEXT NOT NULL,
      is_system_repo    INTEGER NOT NULL DEFAULT 0,
      github_owner      TEXT,
      github_name       TEXT,
      discovered_at     INTEGER NOT NULL,
      last_seen_at      INTEGER NOT NULL,
      deleted_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_repos_last_seen ON repos(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_repos_github ON repos(github_owner, github_name);

    CREATE TABLE IF NOT EXISTS snapshots (
      repo_id            INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
      branch             TEXT,
      upstream           TEXT,
      head_sha           TEXT,
      upstream_sha       TEXT,
      ahead              INTEGER NOT NULL DEFAULT 0,
      behind             INTEGER NOT NULL DEFAULT 0,
      dirty_tracked      INTEGER NOT NULL DEFAULT 0,
      staged             INTEGER NOT NULL DEFAULT 0,
      staged_deletions   INTEGER NOT NULL DEFAULT 0,
      untracked          INTEGER NOT NULL DEFAULT 0,
      conflicted         INTEGER NOT NULL DEFAULT 0,
      detached           INTEGER NOT NULL DEFAULT 0,
      last_commit_sha    TEXT,
      last_commit_ts     INTEGER,
      last_commit_subject TEXT,
      remote_url         TEXT,
      remote_ahead       INTEGER,
      remote_behind      INTEGER,
      remote_state       TEXT,
      remote_sha         TEXT,
      open_pr_count      INTEGER NOT NULL DEFAULT 0,
      weird_flags        TEXT NOT NULL DEFAULT '[]',
      collected_at       INTEGER NOT NULL,
      remote_checked_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS gh_etag_cache (
      key        TEXT PRIMARY KEY,
      etag       TEXT NOT NULL,
      body_json  TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actions_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      action        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      finished_at   INTEGER,
      exit_code     INTEGER,
      truncated_output TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_actions_repo ON actions_log(repo_id, started_at DESC);
  `);
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
