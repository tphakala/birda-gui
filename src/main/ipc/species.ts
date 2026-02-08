import { ipcMain } from 'electron';
import { fetchSpecies } from '../birda/species';
import {
  createSpeciesList,
  getSpeciesLists,
  getSpeciesListEntries,
  deleteSpeciesList,
  createCustomSpeciesList,
} from '../db/species-lists';
import { resolveAll } from '../labels/label-service';
import type {
  SpeciesFetchRequest,
  SpeciesListEntry,
  EnrichedSpeciesListEntry,
  BirdaSpeciesResponse,
} from '$shared/types';

function enrichEntries(entries: SpeciesListEntry[]): EnrichedSpeciesListEntry[] {
  const scientificNames = entries.map((e) => e.scientific_name);
  const nameMap = resolveAll(scientificNames);
  return entries.map((e) => ({
    ...e,
    resolved_common_name: nameMap.get(e.scientific_name) ?? e.common_name ?? e.scientific_name,
  }));
}

export function registerSpeciesHandlers(): void {
  ipcMain.handle('species:fetch', async (_event, request: SpeciesFetchRequest) => {
    return fetchSpecies(request.latitude, request.longitude, request.week, request.threshold);
  });

  ipcMain.handle('species:save-list', (_event, name: string, response: BirdaSpeciesResponse) => {
    return createSpeciesList(name, 'fetched', response.species, {
      latitude: response.lat,
      longitude: response.lon,
      week: response.week,
      threshold: response.threshold,
    });
  });

  ipcMain.handle(
    'species:create-custom-list',
    (_event, name: string, scientificNames: string[], description?: string) => {
      return createCustomSpeciesList(name, scientificNames, description);
    },
  );

  ipcMain.handle('species:get-lists', () => {
    return getSpeciesLists();
  });

  ipcMain.handle('species:get-entries', (_event, listId: number) => {
    const entries = getSpeciesListEntries(listId);
    return enrichEntries(entries);
  });

  ipcMain.handle('species:delete-list', (_event, id: number) => {
    deleteSpeciesList(id);
  });
}
