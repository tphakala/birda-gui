import { getDb } from './database';
import type { Detection, DetectionFilter, SpeciesSummary, CatalogStats } from '$shared/types';
import type { BirdaDetection } from '../birda/types';
import fs from 'fs';

interface RawRunSpeciesAggregation {
  scientific_name: string;
  detection_count: number;
  avg_confidence: number;
  max_confidence: number;
  first_detected: string;
  last_detected: string;
}

interface RawGridDetection {
  scientific_name: string;
  start_time: number;
  source_file: string;
}

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

function buildWhereClause(filter: DetectionFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.scientific_names && filter.scientific_names.length > 0) {
    const placeholders = filter.scientific_names.map(() => '?').join(', ');
    if (filter.species) {
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
  if (filter.species_list_id) {
    conditions.push('scientific_name IN (SELECT scientific_name FROM species_list_entries WHERE list_id = ?)');
    params.push(filter.species_list_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

export function getDetections(filter: DetectionFilter): { detections: Detection[]; total: number } {
  const db = getDb();
  const { where, params } = buildWhereClause(filter);
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

export function getRunSpeciesAggregation(filter: DetectionFilter): RawRunSpeciesAggregation[] {
  const db = getDb();
  const { where, params } = buildWhereClause(filter);

  const allowedSortColumns = new Set([
    'scientific_name',
    'detection_count',
    'avg_confidence',
    'max_confidence',
    'first_detected',
    'last_detected',
  ]);
  const sortCol =
    filter.sort_column && allowedSortColumns.has(filter.sort_column) ? filter.sort_column : 'detection_count';
  const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';

  return db
    .prepare(
      `SELECT scientific_name,
              COUNT(*) AS detection_count,
              AVG(confidence) AS avg_confidence,
              MAX(confidence) AS max_confidence,
              MIN(detected_at) AS first_detected,
              MAX(detected_at) AS last_detected
       FROM detections ${where}
       GROUP BY scientific_name
       ORDER BY ${sortCol} ${sortDir}`,
    )
    .all(...params) as RawRunSpeciesAggregation[];
}

export function getDetectionsForGrid(filter: DetectionFilter): RawGridDetection[] {
  const db = getDb();
  const { where, params } = buildWhereClause(filter);

  return db
    .prepare(`SELECT scientific_name, start_time, source_file FROM detections ${where}`)
    .all(...params) as RawGridDetection[];
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

async function readJsonWithRetry(jsonPath: string, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fs.promises.readFile(jsonPath, 'utf-8');
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      // Exponential backoff for Windows file locking
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, i)));
    }
  }
  throw new Error('Unreachable'); // TypeScript flow analysis
}

interface BirdaJsonOutput {
  metadata: {
    file: string;
    model: string;
    min_confidence: number;
  };
  detections: Array<{
    start_time: number;
    end_time: number;
    scientific_name: string;
    confidence: number;
  }>;
}

export async function importDetectionsFromJson(
  runId: number,
  locationId: number | null,
  jsonPath: string,
): Promise<{ detections: number; sourceFile: string }> {
  // Read with retry logic for Windows file locking
  const content = await readJsonWithRetry(jsonPath);

  // Parse JSON
  const data: BirdaJsonOutput = JSON.parse(content);

  // Extract source file from metadata
  const sourceFile = data.metadata.file;

  // Convert to BirdaDetection format (add missing fields)
  const birdaDetections: BirdaDetection[] = data.detections.map((d) => ({
    start_time: d.start_time,
    end_time: d.end_time,
    scientific_name: d.scientific_name,
    confidence: d.confidence,
    species: d.scientific_name, // Use scientific_name as species identifier
    common_name: '', // JSON output doesn't include common names
  }));

  // Import detections using existing transaction-based function
  if (birdaDetections.length > 0) {
    insertDetections(runId, locationId, sourceFile, birdaDetections);
  }

  return {
    detections: birdaDetections.length,
    sourceFile,
  };
}
