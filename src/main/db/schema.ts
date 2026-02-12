export const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(scientific_name);
CREATE INDEX IF NOT EXISTS idx_detections_location ON detections(location_id);
CREATE INDEX IF NOT EXISTS idx_detections_run ON detections(run_id);
CREATE INDEX IF NOT EXISTS idx_detections_confidence ON detections(confidence);

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
