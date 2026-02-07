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
}

export function clearDatabase(): { detections: number; runs: number; locations: number } {
  const d = getDb();
  const counts = d.transaction(() => {
    const detections = (d.prepare('SELECT COUNT(*) as c FROM detections').get() as { c: number }).c;
    const runs = (d.prepare('SELECT COUNT(*) as c FROM analysis_runs').get() as { c: number }).c;
    const locations = (d.prepare('SELECT COUNT(*) as c FROM locations').get() as { c: number }).c;
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
