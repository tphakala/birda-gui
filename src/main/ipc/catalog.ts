import { ipcMain } from 'electron';
import {
  getDetections,
  getRunSpeciesAggregation,
  getDetectionsForGrid,
  searchSpecies,
  getSpeciesSummary,
  getSpeciesLocations,
  getLocationSpecies,
  getCatalogStats,
} from '../db/detections';
import { clearDatabase } from '../db/database';
import { getLocations, getLocationsWithCounts } from '../db/locations';
import { getRunsWithStats, deleteRun } from '../db/runs';
import { resolveAll, searchByCommonName } from '../labels/label-service';
import type {
  Detection,
  DetectionFilter,
  SpeciesSummary,
  EnrichedDetection,
  EnrichedSpeciesSummary,
  RunSpeciesAggregation,
  HourlyDetectionCell,
  AudioFile,
} from '$shared/types';

function enrichDetections(detections: (Detection & { audio_file: AudioFile })[]): EnrichedDetection[] {
  const scientificNames = [...new Set(detections.map((d) => d.scientific_name))];
  const nameMap = resolveAll(scientificNames);
  return detections.map((d) => ({
    ...d,
    common_name: nameMap.get(d.scientific_name) ?? d.scientific_name,
  }));
}

/**
 * Compute the wall-clock hour (0-23) of a detection by parsing
 * the AudioMoth-style filename (YYYYMMDD_HHMMSS) and adding start_time offset.
 * AudioMoth timestamps are UTC, so we use Date.UTC for correct parsing.
 * Falls back to the hour derived from start_time offset when the filename
 * doesn't match the expected pattern.
 */
function computeDetectionHour(filePath: string, startTime: number): number {
  const base = filePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    // Validate parsed date wasn't silently corrected (e.g. month 13 → next year)
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) {
      return Math.floor(startTime / 3600) % 24;
    }
    const actual = new Date(date.getTime() + startTime * 1000);
    return actual.getUTCHours();
  }
  // Fallback: treat start_time as offset from midnight (hour within recording)
  return Math.floor(startTime / 3600) % 24;
}

/** Resolve common name species filter to scientific names via label service. */
function resolveSpeciesFilter(filter: DetectionFilter): DetectionFilter {
  if (filter.species) {
    const matchingScientific = searchByCommonName(filter.species);
    if (matchingScientific.length > 0) {
      return { ...filter, scientific_names: matchingScientific };
    }
  }
  return filter;
}

function enrichSpeciesSummaries(summaries: SpeciesSummary[]): EnrichedSpeciesSummary[] {
  const scientificNames = summaries.map((s) => s.scientific_name);
  const nameMap = resolveAll(scientificNames);
  return summaries.map((s) => ({
    ...s,
    common_name: nameMap.get(s.scientific_name) ?? s.scientific_name,
  }));
}

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:get-runs', () => {
    return getRunsWithStats();
  });

  ipcMain.handle('catalog:delete-run', (_event, id: number) => {
    deleteRun(id);
  });

  ipcMain.handle('catalog:get-detections', (_event, filter: DetectionFilter) => {
    filter = resolveSpeciesFilter(filter);
    const result = getDetections(filter);
    return { detections: enrichDetections(result.detections), total: result.total };
  });

  ipcMain.handle('catalog:get-run-species', (_event, filter: DetectionFilter): RunSpeciesAggregation[] => {
    filter = resolveSpeciesFilter(filter);
    const rows = getRunSpeciesAggregation(filter);
    const scientificNames = rows.map((r) => r.scientific_name);
    const nameMap = resolveAll(scientificNames);
    return rows.map((r) => ({
      ...r,
      common_name: nameMap.get(r.scientific_name) ?? r.scientific_name,
    }));
  });

  ipcMain.handle('catalog:get-hourly-detections', (_event, filter: DetectionFilter): HourlyDetectionCell[] => {
    filter = resolveSpeciesFilter(filter);

    // Fetch raw detections and compute actual wall-clock hour from filename + offset
    const rows = getDetectionsForGrid(filter);
    const counters = new Map<string, number>();
    const speciesNames = new Set<string>();

    for (const row of rows) {
      const hour = computeDetectionHour(row.file_path, row.start_time);
      const key = `${row.scientific_name}\0${hour}`;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      speciesNames.add(row.scientific_name);
    }

    const nameMap = resolveAll([...speciesNames]);
    const result: HourlyDetectionCell[] = [];
    for (const [key, count] of counters) {
      const [sci, hourStr] = key.split('\0');
      result.push({
        scientific_name: sci,
        common_name: nameMap.get(sci) ?? sci,
        hour: parseInt(hourStr, 10),
        detection_count: count,
      });
    }
    return result;
  });

  ipcMain.handle('catalog:search-species', (_event, query: string) => {
    // Get scientific names matching the common name query from label service
    const matchingScientific = searchByCommonName(query);
    const dbResults = searchSpecies(query, matchingScientific.length > 0 ? matchingScientific : undefined);
    return enrichSpeciesSummaries(dbResults);
  });

  ipcMain.handle('catalog:get-species-summary', () => {
    return enrichSpeciesSummaries(getSpeciesSummary());
  });

  ipcMain.handle('catalog:species-locations', (_event, scientificName: string) => {
    return getSpeciesLocations(scientificName);
  });

  ipcMain.handle('catalog:location-species', (_event, locationId: number) => {
    return enrichSpeciesSummaries(getLocationSpecies(locationId));
  });

  ipcMain.handle('catalog:get-locations', () => {
    return getLocations();
  });

  ipcMain.handle('catalog:get-locations-with-counts', () => {
    return getLocationsWithCounts();
  });

  ipcMain.handle('catalog:stats', () => {
    return getCatalogStats();
  });

  ipcMain.handle('catalog:clear-database', () => {
    return clearDatabase();
  });
}
