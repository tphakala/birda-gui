import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'birda-catalog.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );

  // Migration 1: Remove common_name from detections table
  if (!applied.has(1)) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(detections)').all() as { name: string }[];
      if (columns.some((c) => c.name === 'common_name')) {
        // Drop the view first (it references common_name)
        db.exec('DROP VIEW IF EXISTS species_summary');
        db.exec('ALTER TABLE detections DROP COLUMN common_name');
        // Recreate view without common_name
        db.exec(`
          CREATE VIEW IF NOT EXISTS species_summary AS
          SELECT
            scientific_name,
            COUNT(DISTINCT location_id) AS location_count,
            COUNT(*) AS detection_count,
            MAX(detected_at) AS last_detected,
            AVG(confidence) AS avg_confidence
          FROM detections
          GROUP BY scientific_name
        `);
      }
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(1);
    })();
  }

  // Migration 2: Species lists
  if (!applied.has(2)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS species_lists (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL,
          description     TEXT,
          source          TEXT NOT NULL CHECK (source IN ('fetched','custom')),
          latitude        REAL,
          longitude       REAL,
          week            INTEGER,
          threshold       REAL,
          species_count   INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS species_list_entries (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          list_id         INTEGER NOT NULL REFERENCES species_lists(id) ON DELETE CASCADE,
          scientific_name TEXT NOT NULL,
          common_name     TEXT,
          frequency       REAL,
          UNIQUE(list_id, scientific_name)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_sle_list ON species_list_entries(list_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sle_species ON species_list_entries(scientific_name)');
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(2);
    })();
  }

  // Migration 3: Add timezone_offset_min to analysis_runs
  if (!applied.has(3)) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(analysis_runs)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'timezone_offset_min')) {
        db.exec('ALTER TABLE analysis_runs ADD COLUMN timezone_offset_min INTEGER');
      }
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(3);
    })();
  }

  // Migration 4: Add completed_with_errors status
  if (!applied.has(4)) {
    console.log('Migrating to version 4: Add completed_with_errors status');

    // Temporarily disable foreign keys for table recreation
    db.pragma('foreign_keys = OFF');

    try {
      db.transaction(() => {
        db.exec(`
          -- Create new table with updated constraint
          CREATE TABLE analysis_runs_new (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id         INTEGER REFERENCES locations(id),
            source_path         TEXT NOT NULL,
            model               TEXT NOT NULL,
            min_confidence      REAL NOT NULL DEFAULT 0.1,
            settings_json       TEXT,
            status              TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','completed','failed','completed_with_errors')),
            started_at          TEXT,
            completed_at        TEXT,
            timezone_offset_min INTEGER
          );

          -- Copy existing data
          INSERT INTO analysis_runs_new
            SELECT id, location_id, source_path, model, min_confidence, settings_json,
                   status, started_at, completed_at, timezone_offset_min
            FROM analysis_runs;

          -- Drop old table
          DROP TABLE analysis_runs;

          -- Rename new table
          ALTER TABLE analysis_runs_new RENAME TO analysis_runs;
        `);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(4);
      })();
    } finally {
      // Re-enable foreign keys even if migration fails
      db.pragma('foreign_keys = ON');
    }
  }
}

export function clearDatabase(): { detections: number; runs: number; locations: number } {
  const d = getDb();
  const counts = d.transaction(() => {
    const detections = (d.prepare('SELECT COUNT(*) as c FROM detections').get() as { c: number }).c;
    const runs = (d.prepare('SELECT COUNT(*) as c FROM analysis_runs').get() as { c: number }).c;
    const locations = (d.prepare('SELECT COUNT(*) as c FROM locations').get() as { c: number }).c;
    d.exec('DELETE FROM species_list_entries');
    d.exec('DELETE FROM species_lists');
    d.exec('DELETE FROM detections');
    d.exec('DELETE FROM analysis_runs');
    d.exec('DELETE FROM locations');
    return { detections, runs, locations };
  })();
  d.exec('VACUUM');
  return counts;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
