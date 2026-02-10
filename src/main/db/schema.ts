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
                        CHECK (status IN ('pending','running','completed','failed')),
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
