import { getDb } from './database';
import type { Location } from '$shared/types';
import { FINISHED_RUN_IDS } from './schema';

export function createLocation(
  latitude: number,
  longitude: number,
  name?: string | null,
  description?: string | null,
): Location {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO locations (name, latitude, longitude, description) VALUES (?, ?, ?, ?)');
  const result = stmt.run(name ?? null, latitude, longitude, description ?? null);
  const location = getLocationById(result.lastInsertRowid as number);
  if (!location) throw new Error('Failed to create location');
  return location;
}

export function getLocations(): Location[] {
  const db = getDb();
  return db.prepare('SELECT * FROM locations ORDER BY created_at DESC').all() as Location[];
}

function getLocationById(id: number): Location | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as Location | undefined;
}

export function findLocationByCoords(latitude: number, longitude: number): Location | undefined {
  const db = getDb();
  // Find existing location within ~100m radius (approx 0.001 degrees)
  return db
    .prepare(
      `
    SELECT * FROM locations
    WHERE ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001
    LIMIT 1
  `,
    )
    .get(latitude, longitude) as Location | undefined;
}

/**
 * Locations with detections from finished runs, for the map. A location whose
 * runs ended without detections (failed, stopped early or found nothing) stays
 * saved for the analysis form's location picker (getLocations) but has no marker.
 */
export function getLocationsWithCounts(): (Location & { detection_count: number; species_count: number })[] {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT l.*, d.detection_count, d.species_count
    FROM locations l
    JOIN (
      SELECT location_id,
        COUNT(*) as detection_count,
        COUNT(DISTINCT scientific_name) as species_count
      FROM detections
      WHERE location_id IS NOT NULL AND run_id IN (${FINISHED_RUN_IDS})
      GROUP BY location_id
    ) d ON l.id = d.location_id
    ORDER BY detection_count DESC
  `,
    )
    .all() as (Location & { detection_count: number; species_count: number })[];
}
