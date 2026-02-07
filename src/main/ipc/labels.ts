import { ipcMain } from 'electron';
import { searchByCommonName, resolveAll } from '../labels/label-service';
import { getRegistryLanguages, type RegistryLanguage } from '../birda/config';
import { listModels } from '../birda/models';

export function registerLabelHandlers(): void {
  ipcMain.handle('labels:resolve-all', (_event, scientificNames: string[]) => {
    const map = resolveAll(scientificNames);
    return Object.fromEntries(map);
  });

  ipcMain.handle('labels:search-by-common-name', (_event, query: string) => {
    return searchByCommonName(query);
  });

  ipcMain.handle('labels:available-languages', async (): Promise<{ code: string; name: string }[]> => {
    try {
      const models = await listModels();
      const defaultModel = models.find((m) => m.is_default) ?? models[0];
      const languages = await getRegistryLanguages(defaultModel.id);
      return languages.map((l: RegistryLanguage) => ({ code: l.code, name: l.name }));
    } catch {
      return [];
    }
  });
}
