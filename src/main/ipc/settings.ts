import { ipcMain, dialog, shell } from 'electron';
import { getConfig, getConfigPath } from '../birda/config';
import { findBirda, setBirdaPath } from '../birda/runner';
import { listModels } from '../birda/models';
import { buildLabelsPath, reloadLabels } from '../labels/label-service';
import { loadSettings, saveSettings } from '../settings/loader';
import type { AppSettings } from '$shared/types';

export async function registerSettingsHandlers(): Promise<void> {
  // Apply saved birda path at startup so all handlers can find birda immediately
  const initial = await loadSettings();
  if (initial.birda_path) {
    setBirdaPath(initial.birda_path);
  }

  ipcMain.handle('app:get-settings', async () => {
    return await loadSettings();
  });

  ipcMain.handle('app:set-settings', async (_event, settings: Partial<AppSettings>) => {
    const current = await loadSettings();
    const updated = { ...current, ...settings };
    await saveSettings(updated);
    if (updated.birda_path) {
      setBirdaPath(updated.birda_path);
    }
    // Reload labels if species language changed
    if (settings.species_language && settings.species_language !== current.species_language) {
      try {
        const models = await listModels();
        const defaultModel = models.find((m) => m.is_default) ?? models[0];
        if (defaultModel.labels_path) {
          const labelsPath = buildLabelsPath(defaultModel.labels_path, updated.species_language);
          await reloadLabels(labelsPath);
        }
      } catch (err) {
        console.error('[labels] Failed to reload labels:', err);
      }
    }
    return updated;
  });

  ipcMain.handle('app:check-birda', async () => {
    try {
      const birdaPath = await findBirda();
      return { available: true, path: birdaPath };
    } catch (err) {
      return { available: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('birda:config-show', async () => {
    return getConfig();
  });

  ipcMain.handle('birda:config-path', async () => {
    return getConfigPath();
  });

  ipcMain.handle('fs:open-file-dialog', async (_event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:open-executable-dialog', async (_event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe', 'cmd', 'bat', ''] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:open-folder-dialog', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:open-in-explorer', async (_event, folderPath: string) => {
    await shell.openPath(folderPath);
  });

  ipcMain.handle('fs:read-coordinates', async (_event, folderPath: string) => {
    const coordFile = path.join(folderPath, 'coordinates.txt');
    try {
      const content = await fs.promises.readFile(coordFile, 'utf-8');
      const lines = content.trim().split('\n');
      // Try each line - first one that parses as lat,lon wins
      for (const line of lines) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 2) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            return { latitude: lat, longitude: lon };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  });
}
