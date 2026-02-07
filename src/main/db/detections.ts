import { getDb } from './database';
import type { Detection, DetectionFilter, SpeciesSummary, CatalogStats } from '$shared/types';
import type { BirdaDetection } from '../birda/types';

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export function insertDetections(
  runId: number,
  locationId: number | null,
  sourceFile: string,
  detections: BirdaDetection[],
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO detections (run_id, location_id, source_file, start_time, end_time, scientific_name, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((dets: BirdaDetection[]) => {
    for (const d of dets) {
      stmt.run(runId, locationId, sourceFile, d.start_time, d.end_time, d.scientific_name, d.confidence);
    }
  });

  insertMany(detections);
}

export function getDetections(filter: DetectionFilter): { detections: Detection[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.scientific_names && filter.scientific_names.length > 0) {
    // Pre-resolved scientific names (e.g. from label service common name search)
    const placeholders = filter.scientific_names.map(() => '?').join(', ');
    if (filter.species) {
      // Also match scientific_name by LIKE in case the query is a partial scientific name
      conditions.push(`(scientific_name IN (${placeholders}) OR scientific_name LIKE ? ESCAPE '\\')`);
      params.push(...filter.scientific_names, `%${escapeLike(filter.species)}%`);
    } else {
      conditions.push(`scientific_name IN (${placeholders})`);
      params.push(...filter.scientific_names);
    }
  } else if (filter.species) {
    conditions.push("scientific_name LIKE ? ESCAPE '\\'");
    const escaped = escapeLike(filter.species);
    params.push(`%${escaped}%`);
  }
  if (filter.location_id) {
    conditions.push('location_id = ?');
    params.push(filter.location_id);
  }
  if (filter.min_confidence) {
    conditions.push('confidence >= ?');
    params.push(filter.min_confidence);
  }
  if (filter.run_id) {
    conditions.push('run_id = ?');
    params.push(filter.run_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  // Whitelist allowed sort columns to prevent SQL injection
  const allowedSortColumns = new Set(['scientific_name', 'confidence', 'start_time', 'source_file', 'detected_at']);
  const sortCol = filter.sort_column && allowedSortColumns.has(filter.sort_column) ? filter.sort_column : 'detected_at';
  const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM detections ${where}`).get(...params) as { count: number })
    .count;
  const detections = db
    .prepare(`SELECT * FROM detections ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Detection[];

  return { detections, total };
}

export function searchSpecies(query: string, scientificNames?: string[]): SpeciesSummary[] {
  const db = getDb();
  const escaped = escapeLike(query);

  if (scientificNames && scientificNames.length > 0) {
    // Search by scientific name LIKE or by pre-resolved names from label service
    const placeholders = scientificNames.map(() => '?').join(', ');
    return db
      .prepare(
        `
      SELECT * FROM species_summary
      WHERE scientific_name LIKE ? ESCAPE '\\' OR scientific_name IN (${placeholders})
      ORDER BY detection_count DESC
      LIMIT 20
    `,
      )
      .all(`%${escaped}%`, ...scientificNames) as SpeciesSummary[];
  }

  return db
    .prepare(
      `
    SELECT * FROM species_summary
    WHERE scientific_name LIKE ? ESCAPE '\\'
    ORDER BY detection_count DESC
    LIMIT 20
  `,
    )
    .all(`%${escaped}%`) as SpeciesSummary[];
}

export function getSpeciesSummary(): SpeciesSummary[] {
  const db = getDb();
  return db.prepare('SELECT * FROM species_summary ORDER BY detection_count DESC').all() as SpeciesSummary[];
}

export function getSpeciesLocations(
  scientificName: string,
): { location_id: number; latitude: number; longitude: number; name: string | null; detection_count: number }[] {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT d.location_id, l.latitude, l.longitude, l.name, COUNT(*) as detection_count
    FROM detections d
    JOIN locations l ON d.location_id = l.id
    WHERE d.scientific_name = ?
    GROUP BY d.location_id
  `,
    )
    .all(scientificName) as {
    location_id: number;
    latitude: number;
    longitude: number;
    name: string | null;
    detection_count: number;
  }[];
}

export function getLocationSpecies(locationId: number): SpeciesSummary[] {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT scientific_name,
           1 as location_count,
           COUNT(*) as detection_count,
           MAX(detected_at) as last_detected,
           AVG(confidence) as avg_confidence
    FROM detections
    WHERE location_id = ?
    GROUP BY scientific_name
    ORDER BY detection_count DESC
  `,
    )
    .all(locationId) as SpeciesSummary[];
}

export function getCatalogStats(): CatalogStats {
  const db = getDb();
  const result = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM detections) as total_detections,
      (SELECT COUNT(DISTINCT scientific_name) FROM detections) as total_species,
      (SELECT COUNT(*) FROM locations) as total_locations
  `,
    )
    .get() as CatalogStats;
  return result;
}

export function updateDetectionClipPath(id: number, clipPath: string): void {
  const db = getDb();
  db.prepare('UPDATE detections SET clip_path = ? WHERE id = ?').run(clipPath, id);
}
