import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeCatalog } from './database';

// database.ts reads app.getPath only in getDbPath, which these tests never call.
vi.mock('electron', () => ({ app: {} }));

// A catalog as v1.0.0 left it: its SCHEMA_SQL plus migrations 1 and 2.
const V1_0_0_CATALOG = `
CREATE TABLE locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE analysis_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id     INTEGER REFERENCES locations(id),
    source_path     TEXT NOT NULL,
    model           TEXT NOT NULL,
    min_confidence  REAL NOT NULL DEFAULT 0.1,
    settings_json   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
    started_at      TEXT,
    completed_at    TEXT
);
CREATE TABLE detections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES analysis_runs(id),
    location_id     INTEGER REFERENCES locations(id),
    source_file     TEXT NOT NULL,
    start_time      REAL NOT NULL,
    end_time        REAL NOT NULL,
    scientific_name TEXT NOT NULL,
    confidence      REAL NOT NULL,
    clip_path       TEXT,
    detected_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_detections_species ON detections(scientific_name);
CREATE INDEX idx_detections_location ON detections(location_id);
CREATE INDEX idx_detections_run ON detections(run_id);
CREATE INDEX idx_detections_confidence ON detections(confidence);
CREATE VIEW species_summary AS
SELECT scientific_name, COUNT(DISTINCT location_id) AS location_count, COUNT(*) AS detection_count,
       MAX(detected_at) AS last_detected, AVG(confidence) AS avg_confidence
FROM detections GROUP BY scientific_name;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE species_lists (
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
);
CREATE TABLE species_list_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id         INTEGER NOT NULL REFERENCES species_lists(id) ON DELETE CASCADE,
    scientific_name TEXT NOT NULL,
    common_name     TEXT,
    frequency       REAL,
    UNIQUE(list_id, scientific_name)
);
CREATE INDEX idx_sle_list ON species_list_entries(list_id);
CREATE INDEX idx_sle_species ON species_list_entries(scientific_name);
INSERT INTO schema_migrations (version) VALUES (1), (2);

INSERT INTO locations (id, name, latitude, longitude) VALUES (1, 'Pond', 60.1, 24.9);
INSERT INTO analysis_runs (id, location_id, source_path, model, status) VALUES (1, 1, '/rec', 'birdnet', 'completed');
INSERT INTO detections (run_id, location_id, source_file, start_time, end_time, scientific_name, confidence) VALUES
    (1, 1, '/rec/20240501_053000.wav', 0, 3, 'Turdus merula', 0.9),
    (1, 1, '/rec/20240501_053000.wav', 3, 6, 'Erithacus rubecula', 0.8),
    (1, 1, '/rec/other.wav', 0, 3, 'Turdus merula', 0.7);
`;

const open: Database.Database[] = [];

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

// Everything that defines the schema's shape, without the CREATE statements'
// formatting (migrations and SCHEMA_SQL write the same tables differently).
function schemaShape(db: Database.Database) {
  const objects = db
    .prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as { type: string; name: string; tbl_name: string }[];
  const tables = objects.filter((o) => o.type === 'table').map((o) => o.name);
  const columns = Object.fromEntries(tables.map((t) => [t, db.pragma(`table_info(${t})`)]));
  const foreignKeys = Object.fromEntries(tables.map((t) => [t, db.pragma(`foreign_key_list(${t})`)]));
  const indexColumns = Object.fromEntries(
    objects.filter((o) => o.type === 'index').map((o) => [o.name, db.pragma(`index_info(${o.name})`)]),
  );
  return { objects, columns, foreignKeys, indexColumns };
}

function appliedVersions(db: Database.Database): number[] {
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
    (r) => r.version,
  );
}

describe('initializeCatalog', () => {
  it('upgrades a v1.0.0 catalog to the same schema as a new catalog', () => {
    const fresh = memoryDb();
    initializeCatalog(fresh);

    const upgraded = memoryDb();
    upgraded.exec(V1_0_0_CATALOG);
    initializeCatalog(upgraded);

    expect(schemaShape(upgraded)).toEqual(schemaShape(fresh));
    expect(appliedVersions(upgraded)).toEqual(appliedVersions(fresh));
  });

  it('keeps v1.0.0 detections, linked to one audio_files row per source file', () => {
    const db = memoryDb();
    db.exec(V1_0_0_CATALOG);
    initializeCatalog(db);

    const rows = db
      .prepare(
        `SELECT d.scientific_name, a.file_path, a.file_name, a.recording_start
         FROM detections d JOIN audio_files a ON a.id = d.audio_file_id
         ORDER BY d.id`,
      )
      .all();
    expect(rows).toEqual([
      {
        scientific_name: 'Turdus merula',
        file_path: '/rec/20240501_053000.wav',
        file_name: '20240501_053000.wav',
        recording_start: '2024-05-01 05:30:00',
      },
      {
        scientific_name: 'Erithacus rubecula',
        file_path: '/rec/20240501_053000.wav',
        file_name: '20240501_053000.wav',
        recording_start: '2024-05-01 05:30:00',
      },
      { scientific_name: 'Turdus merula', file_path: '/rec/other.wav', file_name: 'other.wav', recording_start: null },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('changes nothing when a current catalog is opened again', () => {
    const db = memoryDb();
    initializeCatalog(db);
    const shape = schemaShape(db);
    const versions = appliedVersions(db);

    initializeCatalog(db);
    expect(schemaShape(db)).toEqual(shape);
    expect(appliedVersions(db)).toEqual(versions);
  });
});
