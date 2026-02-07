import { ipcMain } from 'electron';
import {
  getDetections,
  searchSpecies,
  getSpeciesSummary,
  getSpeciesLocations,
  getLocationSpecies,
  getCatalogStats,
} from '../db/detections';
import { clearDatabase } from '../db/database';
import { getLocations, getLocationsWithCounts } from '../db/locations';
import { getRunsWithStats } from '../db/runs';
import { resolveAll, searchByCommonName } from '../labels/label-service';
import type {
  Detection,
  DetectionFilter,
  SpeciesSummary,
  EnrichedDetection,
  EnrichedSpeciesSummary,
} from '$shared/types';

function enrichDetections(detections: Detection[]): EnrichedDetection[] {
  const scientificNames = [...new Set(detections.map((d) => d.scientific_name))];
  const nameMap = resolveAll(scientificNames);
  return detections.map((d) => ({
    ...d,
    common_name: nameMap.get(d.scientific_name) ?? d.scientific_name,
  }));
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

  ipcMain.handle('catalog:get-detections', (_event, filter: DetectionFilter) => {
    // If species filter is set, also resolve common name matches from label service
    if (filter.species) {
      const matchingScientific = searchByCommonName(filter.species);
      if (matchingScientific.length > 0) {
        filter = { ...filter, scientific_names: matchingScientific };
      }
    }

    const result = getDetections(filter);
    return { detections: enrichDetections(result.detections), total: result.total };
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
