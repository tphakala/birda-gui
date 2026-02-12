import { getDb } from './database';
import type { Detection, DetectionFilter, SpeciesSummary, CatalogStats, AudioFile } from '$shared/types';
import type { BirdaDetection } from '../birda/types';
import fs from 'fs';
import { z } from 'zod';

const JSON_READ_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 100;

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
  file_path: string;
}

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export function insertDetections(
  runId: number,
  locationId: number | null,
  audioFileId: number,
  detections: BirdaDetection[],
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO detections (run_id, location_id, audio_file_id, start_time, end_time, scientific_name, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((dets: BirdaDetection[]) => {
    for (const d of dets) {
      stmt.run(runId, locationId, audioFileId, d.start_time, d.end_time, d.scientific_name, d.confidence);
    }
  });

  insertMany(detections);
}

function buildWhereClause(filter: DetectionFilter, tableAlias?: string): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (filter.scientific_names && filter.scientific_names.length > 0) {
    const placeholders = filter.scientific_names.map(() => '?').join(', ');
    if (filter.species) {
      conditions.push(`(${prefix}scientific_name IN (${placeholders}) OR ${prefix}scientific_name LIKE ? ESCAPE '\\')`);
      params.push(...filter.scientific_names, `%${escapeLike(filter.species)}%`);
    } else {
      conditions.push(`${prefix}scientific_name IN (${placeholders})`);
      params.push(...filter.scientific_names);
    }
  } else if (filter.species) {
    conditions.push(`${prefix}scientific_name LIKE ? ESCAPE '\\'`);
    const escaped = escapeLike(filter.species);
    params.push(`%${escaped}%`);
  }
  if (filter.location_id) {
    conditions.push(`${prefix}location_id = ?`);
    params.push(filter.location_id);
  }
  if (filter.min_confidence) {
    conditions.push(`${prefix}confidence >= ?`);
    params.push(filter.min_confidence);
  }
  if (filter.run_id) {
    conditions.push(`${prefix}run_id = ?`);
    params.push(filter.run_id);
  }
  if (filter.species_list_id) {
    conditions.push(`${prefix}scientific_name IN (SELECT scientific_name FROM species_list_entries WHERE list_id = ?)`);
    params.push(filter.species_list_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

export function getDetections(filter: DetectionFilter): { detections: (Detection & { audio_file: AudioFile })[]; total: number } {
  const db = getDb();
  const { where, params } = buildWhereClause(filter, 'd');
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  // Whitelist allowed sort columns to prevent SQL injection
  const allowedSortColumns = new Set(['scientific_name', 'confidence', 'start_time', 'file_name', 'recording_start', 'detected_at']);
  let sortCol = filter.sort_column && allowedSortColumns.has(filter.sort_column) ? filter.sort_column : 'detected_at';

  // Map sort columns to qualified names for JOIN
  if (sortCol === 'file_name') sortCol = 'af.file_name';
  else if (sortCol === 'recording_start') sortCol = 'af.recording_start';
  else sortCol = `d.${sortCol}`;

  const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM detections d ${where}`).get(...params) as { count: number })
    .count;

  const rows = db
    .prepare(`
      SELECT
        d.id, d.run_id, d.location_id, d.audio_file_id, d.start_time, d.end_time,
        d.scientific_name, d.confidence, d.clip_path, d.detected_at,
        af.id as af_id, af.file_path as af_file_path, af.file_name as af_file_name,
        af.recording_start as af_recording_start, af.timezone_offset_min as af_timezone_offset_min,
        af.duration_sec as af_duration_sec, af.sample_rate as af_sample_rate, af.channels as af_channels,
        af.audiomoth_device_id as af_audiomoth_device_id, af.audiomoth_gain as af_audiomoth_gain,
        af.audiomoth_battery_v as af_audiomoth_battery_v, af.audiomoth_temperature_c as af_audiomoth_temperature_c,
        af.created_at as af_created_at
      FROM detections d
      LEFT JOIN audio_files af ON d.audio_file_id = af.id
      ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as Array<{
      id: number;
      run_id: number;
      location_id: number | null;
      audio_file_id: number;
      start_time: number;
      end_time: number;
      scientific_name: string;
      confidence: number;
      clip_path: string | null;
      detected_at: string;
      af_id: number | null;
      af_file_path: string | null;
      af_file_name: string | null;
      af_recording_start: string | null;
      af_timezone_offset_min: number | null;
      af_duration_sec: number | null;
      af_sample_rate: number | null;
      af_channels: number | null;
      af_audiomoth_device_id: string | null;
      af_audiomoth_gain: string | null;
      af_audiomoth_battery_v: number | null;
      af_audiomoth_temperature_c: number | null;
      af_created_at: string | null;
    }>;

  // Transform flat rows into Detection objects with audio_file data
  const detections = rows.map(row => ({
    id: row.id,
    run_id: row.run_id,
    location_id: row.location_id,
    audio_file_id: row.audio_file_id,
    start_time: row.start_time,
    end_time: row.end_time,
    scientific_name: row.scientific_name,
    confidence: row.confidence,
    clip_path: row.clip_path,
    detected_at: row.detected_at,
    audio_file: {
      id: row.af_id!,
      run_id: row.run_id,
      file_path: row.af_file_path!,
      file_name: row.af_file_name!,
      recording_start: row.af_recording_start,
      timezone_offset_min: row.af_timezone_offset_min,
      duration_sec: row.af_duration_sec,
      sample_rate: row.af_sample_rate,
      channels: row.af_channels,
      audiomoth_device_id: row.af_audiomoth_device_id,
      audiomoth_gain: row.af_audiomoth_gain,
      audiomoth_battery_v: row.af_audiomoth_battery_v,
      audiomoth_temperature_c: row.af_audiomoth_temperature_c,
      created_at: row.af_created_at!,
    }
  }));

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
  const { where, params } = buildWhereClause(filter, 'd');

  return db
    .prepare(`
      SELECT d.scientific_name, d.start_time, af.file_path
      FROM detections d
      LEFT JOIN audio_files af ON d.audio_file_id = af.id
      ${where}
    `)
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

async function readJsonWithRetry(jsonPath: string, maxRetries = JSON_READ_RETRIES): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fs.promises.readFile(jsonPath, 'utf-8');
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      // Exponential backoff for Windows file locking
      await new Promise((resolve) => setTimeout(resolve, BASE_RETRY_DELAY_MS * Math.pow(2, i)));
    }
  }
  throw new Error('Unreachable'); // TypeScript flow analysis
}

const BirdaDetectionSchema = z.object({
  start_time: z.number(),
  end_time: z.number(),
  scientific_name: z.string(),
  common_name: z.string(),
  confidence: z.number(),
});

const BirdaJsonSettingsSchema = z.object({
  min_confidence: z.number(),
  overlap: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  week: z.number().optional(),
});

const BirdaJsonSummarySchema = z.object({
  total_detections: z.number(),
  unique_species: z.number(),
  audio_duration_seconds: z.number(),
});

const BirdaJsonOutputSchema = z.object({
  source_file: z.string(),
  analysis_date: z.string(),
  model: z.string(),
  settings: BirdaJsonSettingsSchema,
  detections: z.array(BirdaDetectionSchema),
  summary: BirdaJsonSummarySchema,
});

export async function importDetectionsFromJson(
  runId: number,
  locationId: number | null,
  audioFileId: number,
  jsonPath: string,
): Promise<{ detections: number; sourceFile: string }> {
  // Read with retry logic for Windows file locking
  const content = await readJsonWithRetry(jsonPath);

  // Parse and validate JSON with Zod
  const data = BirdaJsonOutputSchema.parse(JSON.parse(content));

  // Extract source file from top-level field
  const sourceFile = data.source_file;

  // Convert to BirdaDetection format (add missing fields)
  const birdaDetections: BirdaDetection[] = data.detections.map((d) => ({
    start_time: d.start_time,
    end_time: d.end_time,
    scientific_name: d.scientific_name,
    confidence: d.confidence,
    species: d.scientific_name, // Use scientific_name as species identifier
    common_name: d.common_name, // Preserve common_name from JSON output
  }));

  // Import detections using existing transaction-based function
  if (birdaDetections.length > 0) {
    insertDetections(runId, locationId, audioFileId, birdaDetections);
  }

  return {
    detections: birdaDetections.length,
    sourceFile,
  };
}
