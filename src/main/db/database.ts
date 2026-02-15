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

  // Migration 5: Add audio_files table and migrate existing data
  if (!applied.has(5)) {
    console.log('Migrating to version 5: Add audio_files table');

    // Check if detections table has source_file column (old schema)
    const detectionsColumns = db.prepare('PRAGMA table_info(detections)').all() as { name: string }[];
    const hasSourceFile = detectionsColumns.some((c) => c.name === 'source_file');

    if (!hasSourceFile) {
      // New database with current schema - audio_files table already exists via schema.ts
      console.log('Detections table already uses audio_file_id - skipping migration');
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(5);
      return;
    }

    // Temporarily disable foreign keys for table recreation
    db.pragma('foreign_keys = OFF');

    try {
      db.transaction(() => {
        // Create audio_files table
        db.exec(`
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
        `);

        // Migrate existing data: group detections by (run_id, source_file)
        const uniqueFiles = db
          .prepare(
            `
          SELECT DISTINCT run_id, source_file
          FROM detections
          ORDER BY run_id, source_file
        `,
          )
          .all() as { run_id: number; source_file: string }[];

        console.log(`Migrating ${uniqueFiles.length} unique audio files`);

        const insertAudioFile = db.prepare(`
          INSERT INTO audio_files (run_id, file_path, file_name, recording_start, timezone_offset_min)
          VALUES (?, ?, ?, ?, ?)
        `);

        const getRunTimezone = db.prepare(`
          SELECT timezone_offset_min FROM analysis_runs WHERE id = ?
        `);

        // Create temporary mapping table
        db.exec(`
          CREATE TEMP TABLE audio_file_mapping (
            run_id INTEGER NOT NULL,
            source_file TEXT NOT NULL,
            audio_file_id INTEGER NOT NULL,
            PRIMARY KEY (run_id, source_file)
          )
        `);

        const insertMapping = db.prepare(`
          INSERT INTO audio_file_mapping (run_id, source_file, audio_file_id)
          VALUES (?, ?, ?)
        `);

        for (const { run_id, source_file } of uniqueFiles) {
          // Extract file name from path
          const fileName = source_file.split('/').pop() ?? source_file;

          // Try to parse AudioMoth timestamp from filename (YYYYMMDD_HHMMSS)
          let recordingStart: string | null = null;
          const audioMothMatch = /(\d{8})_(\d{6})/.exec(fileName);
          if (audioMothMatch) {
            const [, dateStr, timeStr] = audioMothMatch;
            // Parse: YYYYMMDD -> YYYY-MM-DD, HHMMSS -> HH:MM:SS
            const year = dateStr.slice(0, 4);
            const month = dateStr.slice(4, 6);
            const day = dateStr.slice(6, 8);
            const hour = timeStr.slice(0, 2);
            const minute = timeStr.slice(2, 4);
            const second = timeStr.slice(4, 6);
            recordingStart = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
          }

          // Get timezone from run
          const runData = getRunTimezone.get(run_id) as { timezone_offset_min: number | null } | undefined;
          const timezoneOffset = runData?.timezone_offset_min ?? null;

          // Insert audio file record
          const result = insertAudioFile.run(run_id, source_file, fileName, recordingStart, timezoneOffset);

          // Store mapping for later use
          insertMapping.run(run_id, source_file, result.lastInsertRowid);
        }

        console.log('Audio files migration completed');

        // Drop views that depend on detections table
        db.exec('DROP VIEW IF EXISTS species_summary');

        // Recreate detections table with audio_file_id instead of source_file
        db.exec(`
          CREATE TABLE detections_new (
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
        `);

        // Copy data with audio_file_id from mapping
        db.exec(`
          INSERT INTO detections_new (id, run_id, location_id, audio_file_id, start_time, end_time, scientific_name, confidence, clip_path, detected_at)
          SELECT d.id, d.run_id, d.location_id, m.audio_file_id, d.start_time, d.end_time, d.scientific_name, d.confidence, d.clip_path, d.detected_at
          FROM detections d
          INNER JOIN audio_file_mapping m ON d.run_id = m.run_id AND d.source_file = m.source_file
        `);

        // Drop old table and rename new one
        db.exec('DROP TABLE detections');
        db.exec('ALTER TABLE detections_new RENAME TO detections');

        // Recreate indexes
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(scientific_name);
          CREATE INDEX IF NOT EXISTS idx_detections_location ON detections(location_id);
          CREATE INDEX IF NOT EXISTS idx_detections_run ON detections(run_id);
          CREATE INDEX IF NOT EXISTS idx_detections_confidence ON detections(confidence);
          CREATE INDEX IF NOT EXISTS idx_detections_audio_file ON detections(audio_file_id);
        `);

        // Recreate species_summary view
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

        // Clean up temp table
        db.exec('DROP TABLE audio_file_mapping');

        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(5);
      })();
    } finally {
      // Re-enable foreign keys even if migration fails
      db.pragma('foreign_keys = ON');
    }
  }

  // Migration 6: Fix detections table if source_file column still exists
  if (!applied.has(6)) {
    console.log('Checking if detections table needs fixing...');

    const columns = db.prepare('PRAGMA table_info(detections)').all() as { name: string }[];
    const hasSourceFile = columns.some((c) => c.name === 'source_file');
    const hasAudioFileId = columns.some((c) => c.name === 'audio_file_id');

    if (hasSourceFile && hasAudioFileId) {
      console.log('Fixing detections table: removing source_file column');

      db.pragma('foreign_keys = OFF');

      try {
        db.transaction(() => {
          // Drop views that depend on detections table
          db.exec('DROP VIEW IF EXISTS species_summary');

          // Recreate detections table without source_file
          db.exec(`
            CREATE TABLE detections_new (
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
          `);

          // Copy data
          db.exec(`
            INSERT INTO detections_new (id, run_id, location_id, audio_file_id, start_time, end_time, scientific_name, confidence, clip_path, detected_at)
            SELECT id, run_id, location_id, audio_file_id, start_time, end_time, scientific_name, confidence, clip_path, detected_at
            FROM detections
          `);

          // Drop old table and rename new one
          db.exec('DROP TABLE detections');
          db.exec('ALTER TABLE detections_new RENAME TO detections');

          // Recreate indexes
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(scientific_name);
            CREATE INDEX IF NOT EXISTS idx_detections_location ON detections(location_id);
            CREATE INDEX IF NOT EXISTS idx_detections_run ON detections(run_id);
            CREATE INDEX IF NOT EXISTS idx_detections_confidence ON detections(confidence);
            CREATE INDEX IF NOT EXISTS idx_detections_audio_file ON detections(audio_file_id);
          `);

          // Recreate species_summary view
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

          console.log('Detections table fixed');
        })();
      } finally {
        db.pragma('foreign_keys = ON');
      }
    } else {
      console.log('Detections table is already correct');
    }

    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(6);
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
