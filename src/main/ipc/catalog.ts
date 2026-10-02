import { ipcMain } from 'electron';
import {
  getDetections,
  getRunSpeciesAggregation,
  getHourlyDetectionCounts,
  getHourlyDetectionDays,
  searchSpecies,
  getSpeciesSummary,
  getSpeciesLocations,
  getLocationSpecies,
  getCatalogStats,
} from '../db/detections';
import { clearDatabase, checkDatabaseHealth, optimizeDatabase, vacuumDatabase } from '../db/database';
import { getLocations, getLocationsWithCounts } from '../db/locations';
import { getRunsWithStats, deleteRun, setRunTimezone } from '../db/runs';
import { resolveAll, searchByCommonName } from '../labels/label-service';
import type {
  Detection,
  DetectionFilter,
  SpeciesSummary,
  EnrichedDetection,
  EnrichedSpeciesSummary,
  RunSpeciesAggregation,
  HourlyDetections,
  AudioFile,
} from '$shared/types';
import { activeRunId, isAnalysisActive } from './analysis';
import { currentZoneName, isValidTimeZone, sharedClockDay } from '$shared/time-zone';

function enrichDetections(detections: (Detection & { audio_file: AudioFile | null })[]): EnrichedDetection[] {
  const scientificNames = [...new Set(detections.map((d) => d.scientific_name))];
  const nameMap = resolveAll(scientificNames);
  return detections.map((d) => ({
    ...d,
    common_name: nameMap.get(d.scientific_name) ?? d.scientific_name,
  }));
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
    // The running analysis still writes to its run.
    if (id === activeRunId()) {
      throw new Error('Stop the analysis before deleting its run.');
    }
    deleteRun(id);
  });

  ipcMain.handle('catalog:set-run-timezone', (_event, runId: number, timezone: string) => {
    if (!Number.isInteger(runId)) throw new Error('Invalid run id.');
    // The running analysis still writes this run's files with the old zone.
    if (runId === activeRunId()) {
      throw new Error('Stop the analysis before changing its time zone.');
    }
    if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) {
      throw new Error('Unknown time zone.');
    }
    return setRunTimezone(runId, currentZoneName(timezone));
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

  ipcMain.handle('catalog:get-hourly-detections', (_event, filter: DetectionFilter): HourlyDetections => {
    filter = resolveSpeciesFilter(filter);

    // The hour is worked out in SQL (detection_hour) so the grid does not load every detection.
    const rows = getHourlyDetectionCounts(filter);
    const nameMap = resolveAll([...new Set(rows.map((r) => r.scientific_name))]);
    const cells = rows.map((r) => ({
      scientific_name: r.scientific_name,
      common_name: nameMap.get(r.scientific_name) ?? r.scientific_name,
      hour: r.hour,
      detection_count: r.detection_count,
    }));
    // The grid hours are only one day's sun phases when every counted detection shares a day and zone.
    return { cells, sunDay: sharedClockDay(getHourlyDetectionDays(filter)) };
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
    // Clearing would delete the running analysis's run under it.
    if (isAnalysisActive()) {
      throw new Error('Stop the analysis before clearing the database.');
    }
    return clearDatabase();
  });

  ipcMain.handle('catalog:db-health', () => {
    return checkDatabaseHealth();
  });

  ipcMain.handle('catalog:db-optimize', () => {
    optimizeDatabase();
  });

  ipcMain.handle('catalog:db-vacuum', () => {
    vacuumDatabase();
  });
}
