import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, getDbPath, initializeCatalog } from './database';

// A default no catalog can be created in: better-sqlite3 refuses a path whose
// directory does not exist, so a stray getDb() outside the getDb tests throws.
const NO_USER_DATA = path.join(os.tmpdir(), 'birda-gui-test-no-such-dir', 'userData');
const dirs = vi.hoisted(() => ({ userData: '' }));
dirs.userData = NO_USER_DATA;
vi.mock('electron', () => ({ app: { getPath: () => dirs.userData } }));

// v1.0.0's SCHEMA_SQL.
const V1_0_0_SCHEMA = `
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
`;

// The tables migration 2 creates (every released version ran it), plus
// schema_migrations itself. Neither is in SCHEMA_SQL.
const MIGRATION_TABLES = `
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
`;

// A catalog as v1.0.0 left it: migrations 1 and 2 applied, with detections in
// two runs that both analysed /rec/other.wav.
const V1_0_0_CATALOG = `${V1_0_0_SCHEMA}${MIGRATION_TABLES}
INSERT INTO schema_migrations (version) VALUES (1), (2);

INSERT INTO locations (id, name, latitude, longitude) VALUES (1, 'Pond', 60.1, 24.9);
INSERT INTO analysis_runs (id, location_id, source_path, model, status) VALUES
    (1, 1, '/rec', 'birdnet', 'completed'),
    (2, 1, '/rec/other.wav', 'birdnet', 'completed');
INSERT INTO detections
    (run_id, location_id, source_file, start_time, end_time, scientific_name, confidence, clip_path, detected_at) VALUES
    (1, 1, '/rec/20240501_053000.wav', 0, 3, 'Turdus merula', 0.9, '/clips/1.wav', '2024-05-02 10:00:00'),
    (1, 1, '/rec/20240501_053000.wav', 3, 6, 'Erithacus rubecula', 0.8, NULL, '2024-05-02 10:00:01'),
    (1, NULL, '/rec/other.wav', 1.5, 4.5, 'Parus major', 0.7, NULL, '2024-05-02 10:00:02'),
    (2, 1, '/rec/other.wav', 0, 3, 'Turdus merula', 0.6, '/clips/4.wav', '2024-05-03 09:00:00');
`;

// v1.1.0 through v1.2.1 shipped this SCHEMA_SQL (the current one without the
// annotations table). Frozen here so the fixture keeps matching those releases
// when the current schema changes.
const V1_2_1_SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analysis_runs (
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

CREATE TABLE IF NOT EXISTS detections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    audio_file_id   INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
    start_time      REAL NOT NULL,
    end_time        REAL NOT NULL,
    scientific_name TEXT NOT NULL,
    confidence      REAL NOT NULL,
    clip_path       TEXT,
    detected_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(scientific_name);
CREATE INDEX IF NOT EXISTS idx_detections_location ON detections(location_id);
CREATE INDEX IF NOT EXISTS idx_detections_run ON detections(run_id);
CREATE INDEX IF NOT EXISTS idx_detections_confidence ON detections(confidence);
CREATE INDEX IF NOT EXISTS idx_detections_audio_file ON detections(audio_file_id);

CREATE TABLE IF NOT EXISTS audio_files (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                  INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    file_path               TEXT NOT NULL,
    file_name               TEXT NOT NULL,
    recording_start         TEXT,
    timezone_offset_min     INTEGER,
    duration_sec            REAL,
    sample_rate             INTEGER,
    channels                INTEGER,
    audiomoth_device_id     TEXT,
    audiomoth_gain          TEXT,
    audiomoth_battery_v     REAL,
    audiomoth_temperature_c REAL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audio_files_run ON audio_files(run_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_path ON audio_files(file_path);
CREATE INDEX IF NOT EXISTS idx_audio_files_device ON audio_files(audiomoth_device_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_recording_start ON audio_files(recording_start);

CREATE VIEW IF NOT EXISTS species_summary AS
SELECT
    scientific_name,
    COUNT(DISTINCT location_id) AS location_count,
    COUNT(*) AS detection_count,
    MAX(detected_at) AS last_detected,
    AVG(confidence) AS avg_confidence
FROM detections
GROUP BY scientific_name;
`;

// A catalog as v1.1.0 through v1.2.1 left it, up to the formatting schemaShape
// ignores. A new catalog recorded migrations 1 to 5 on its first launch and 6 on
// its second.
function v121Catalog(versions: number[]): Database.Database {
  const db = memoryDb();
  db.exec(V1_2_1_SCHEMA);
  db.exec(MIGRATION_TABLES);
  const insert = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  for (const v of versions) insert.run(v);
  return db;
}

const open: Database.Database[] = [];

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

// Every schema object with its CREATE statement, ignoring formatting that differs
// between SCHEMA_SQL and the migrations: whitespace and the quotes
// SQLite adds when a table is renamed into place.
function schemaShape(db: Database.Database) {
  const rows = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all() as {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }[];
  return rows.map((r) => ({
    ...r,
    sql:
      r.sql
        ?.replace(/"/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([(),])\s*/g, '$1')
        .trim() ?? null,
  }));
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
    expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);
    // Migrations 4 and 8 widened the status CHECK; the upgraded table must accept the new values.
    upgraded
      .prepare("INSERT INTO analysis_runs (source_path, model, status) VALUES ('/x', 'm', 'completed_with_errors')")
      .run();
    upgraded.prepare("INSERT INTO analysis_runs (source_path, model, status) VALUES ('/x', 'm', 'cancelled')").run();
  });

  it.each([
    ['one launch', [1, 2, 3, 4, 5]],
    ['two launches', [1, 2, 3, 4, 5, 6]],
  ])('upgrades a v1.2.1 catalog after %s to the same schema as a new catalog', (_, versions) => {
    const fresh = memoryDb();
    initializeCatalog(fresh);

    const upgraded = v121Catalog(versions);
    initializeCatalog(upgraded);

    expect(schemaShape(upgraded)).toEqual(schemaShape(fresh));
    expect(appliedVersions(upgraded)).toEqual(appliedVersions(fresh));
    expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('keeps every analysis_runs value and the id sequence through the status rebuilds', () => {
    const db = v121Catalog([1, 2, 3, 4, 5, 6]);
    db.exec(`
      INSERT INTO analysis_runs
        (id, location_id, source_path, model, min_confidence, settings_json, status, started_at, completed_at, timezone_offset_min)
      VALUES
        (1, NULL, '/rec/a', 'birdnet', 0.25, '{"k":1}', 'completed', '2024-05-01 10:00:00', '2024-05-01 10:05:00', 180),
        (2, NULL, '/rec/b', 'perch', 0.5, NULL, 'completed_with_errors', '2024-05-02 11:00:00', '2024-05-02 11:30:00', -300),
        (3, NULL, '/rec/c', 'birdnet', 0.1, NULL, 'failed', '2024-05-03 12:00:00', NULL, NULL);
      DELETE FROM analysis_runs WHERE id = 3;
    `);
    const before = db.prepare('SELECT * FROM analysis_runs ORDER BY id').all();

    initializeCatalog(db);

    expect(db.prepare('SELECT * FROM analysis_runs ORDER BY id').all()).toEqual(before);
    // The deleted run's id is not handed out again.
    const { lastInsertRowid } = db
      .prepare("INSERT INTO analysis_runs (source_path, model, status) VALUES ('/rec/d', 'birdnet', 'cancelled')")
      .run();
    expect(lastInsertRowid).toBe(4);
  });

  it('keeps v1.0.0 detections, linked to one audio_files row per run and source file', () => {
    const db = memoryDb();
    db.exec(V1_0_0_CATALOG);
    initializeCatalog(db);

    const rows = db
      .prepare(
        `SELECT d.id, d.audio_file_id, a.run_id, a.file_path, a.file_name, a.recording_start
         FROM detections d JOIN audio_files a ON a.id = d.audio_file_id
         ORDER BY d.id`,
      )
      .all() as {
      id: number;
      audio_file_id: number;
      run_id: number;
      file_path: string;
      file_name: string;
      recording_start: string | null;
    }[];
    expect(rows.map(({ audio_file_id: _, ...r }) => r)).toEqual([
      {
        id: 1,
        run_id: 1,
        file_path: '/rec/20240501_053000.wav',
        file_name: '20240501_053000.wav',
        recording_start: '2024-05-01 05:30:00',
      },
      {
        id: 2,
        run_id: 1,
        file_path: '/rec/20240501_053000.wav',
        file_name: '20240501_053000.wav',
        recording_start: '2024-05-01 05:30:00',
      },
      { id: 3, run_id: 1, file_path: '/rec/other.wav', file_name: 'other.wav', recording_start: null },
      { id: 4, run_id: 2, file_path: '/rec/other.wav', file_name: 'other.wav', recording_start: null },
    ]);
    const [a, b, c, d] = rows.map((r) => r.audio_file_id);
    expect(a).toBe(b);
    expect(new Set([a, c, d]).size).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audio_files').get()).toEqual({ n: 3 });
    expect(
      db
        .prepare(
          `SELECT id, run_id, location_id, start_time, end_time, scientific_name, confidence, clip_path, detected_at
           FROM detections ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: 1,
        run_id: 1,
        location_id: 1,
        start_time: 0,
        end_time: 3,
        scientific_name: 'Turdus merula',
        confidence: 0.9,
        clip_path: '/clips/1.wav',
        detected_at: '2024-05-02 10:00:00',
      },
      {
        id: 2,
        run_id: 1,
        location_id: 1,
        start_time: 3,
        end_time: 6,
        scientific_name: 'Erithacus rubecula',
        confidence: 0.8,
        clip_path: null,
        detected_at: '2024-05-02 10:00:01',
      },
      {
        id: 3,
        run_id: 1,
        location_id: null,
        start_time: 1.5,
        end_time: 4.5,
        scientific_name: 'Parus major',
        confidence: 0.7,
        clip_path: null,
        detected_at: '2024-05-02 10:00:02',
      },
      {
        id: 4,
        run_id: 2,
        location_id: 1,
        start_time: 0,
        end_time: 3,
        scientific_name: 'Turdus merula',
        confidence: 0.6,
        clip_path: '/clips/4.wav',
        detected_at: '2024-05-03 09:00:00',
      },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('changes nothing when a current catalog is opened again', () => {
    const db = memoryDb();
    initializeCatalog(db);
    db.exec(`
      INSERT INTO analysis_runs (id, source_path, model, status) VALUES (1, '/rec', 'birdnet', 'completed');
      INSERT INTO audio_files (id, run_id, file_path, file_name) VALUES (1, 1, '/rec/a.wav', 'a.wav');
      INSERT INTO detections (run_id, audio_file_id, start_time, end_time, scientific_name, confidence)
        VALUES (1, 1, 0, 3, 'Turdus merula', 0.9);
    `);
    const shape = schemaShape(db);
    const versions = appliedVersions(db);

    initializeCatalog(db);
    expect(schemaShape(db)).toEqual(shape);
    expect(appliedVersions(db)).toEqual(versions);
    expect(db.prepare('SELECT scientific_name, audio_file_id FROM detections').all()).toEqual([
      { scientific_name: 'Turdus merula', audio_file_id: 1 },
    ]);
  });
});

describe('getDb', () => {
  afterEach(() => {
    closeDb();
    fs.rmSync(dirs.userData, { recursive: true, force: true });
    dirs.userData = NO_USER_DATA;
  });

  it('does not keep a connection whose initialization failed', () => {
    dirs.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-catalog-'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(getDbPath(), 'not a database');
    expect(() => getDb()).toThrow();

    // With the bad file gone, getDb opens a new catalog instead of returning the
    // failed connection. Closing that connection is not observable here.
    fs.rmSync(getDbPath());
    const db = getDb();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'detections'").get()).toEqual({
      name: 'detections',
    });
  });
});
