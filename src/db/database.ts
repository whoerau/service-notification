import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database
} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export function openDatabase(path: string): DatabaseHandle {
  const sqlite = new Database(path);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  applySchema(sqlite);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close() {
      sqlite.close();
    }
  };
}

function applySchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      error TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS job_runs_job_id_started_at_idx
      ON job_runs (job_id, started_at);

    CREATE TABLE IF NOT EXISTS dedupe_keys (
      key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS dedupe_keys_job_destination_idx
      ON dedupe_keys (job_id, destination);

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      destination TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_duplicate')),
      sent_at TEXT NOT NULL,
      error TEXT,
      metadata_json TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedupe_destination_unique
      ON notification_deliveries (dedupe_key, destination);

    CREATE INDEX IF NOT EXISTS notification_deliveries_job_sent_at_idx
      ON notification_deliveries (job_id, sent_at);

    CREATE TABLE IF NOT EXISTS failure_counters (
      job_id TEXT PRIMARY KEY,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_failure_at TEXT,
      last_error TEXT,
      alert_sent_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_states (
      job_id TEXT PRIMARY KEY,
      last_status TEXT NOT NULL CHECK (last_status IN ('success', 'failed', 'skipped')),
      last_run_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT,
      metadata_json TEXT
    );
  `);
}
