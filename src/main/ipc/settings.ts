import { ipcMain, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { getConfig, getConfigPath } from '../birda/config';
import { findBirda, setBirdaPath, validateBirdaVersion } from '../birda/runner';
import { listModels } from '../birda/models';
import { buildLabelsPath, reloadLabels } from '../labels/label-service';
import { settingsStore } from '../settings/store';
import type { AppSettings, BirdaCheckResponse } from '$shared/types';
import { BIRDA_GITHUB_URL } from '$shared/constants';

const MINIMUM_BIRDA_VERSION = '1.6.0';

// Cache for version check to avoid spawning birda process on every call
let cachedVersionCheck: Promise<BirdaCheckResponse> | null = null;

// Zod schema for validating untrusted settings input from renderer process
const PartialSettingsSchema = z
  .object({
    birda_path: z.string(),
    clip_output_dir: z.string(),
    db_path: z.string(),
    default_model: z.string(),
    default_confidence: z.number().min(0).max(1),
    default_execution_provider: z.string(),
    default_freq_max: z.number().int().positive(),
    default_spectrogram_height: z.number().int().positive(),
    species_language: z.string(),
    ui_language: z.string(),
    theme: z.enum(['system', 'light', 'dark']),
    setup_completed: z.boolean(),
  })
  .partial()
  .strict(); // Reject unknown properties

export async function registerSettingsHandlers(): Promise<void> {
  // Apply saved birda path at startup so all handlers can find birda immediately
  const initial = await settingsStore.get();
  if (initial.birda_path) {
    setBirdaPath(initial.birda_path);
  }

  ipcMain.handle('app:get-settings', async () => {
    return await settingsStore.get();
  });

  ipcMain.handle('app:set-settings', async (_event, settings: Partial<AppSettings>) => {
    // Validate untrusted input from renderer process
    const validated = PartialSettingsSchema.parse(settings) as Partial<AppSettings>;

    // Store the old language for comparison before atomic update
    const current = await settingsStore.get();
    const oldSpeciesLanguage = current.species_language;

    // Atomic update through mutex-protected store
    const updated = await settingsStore.update(validated);

    // Side effects after successful update
    if (updated.birda_path && updated.birda_path !== current.birda_path) {
      setBirdaPath(updated.birda_path);
      // Invalidate version check cache when path changes
      cachedVersionCheck = null;
    }

    // Reload labels if species language changed
    if (validated.species_language && validated.species_language !== oldSpeciesLanguage) {
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

  ipcMain.handle('app:check-birda', () => {
    // Return cached result if available
    if (cachedVersionCheck) {
      return cachedVersionCheck;
    }

    // Perform check and cache the promise. The promise is cached immediately
    // to prevent concurrent checks from being spawned.
    const promise = (async (): Promise<BirdaCheckResponse> => {
      try {
        const birdaPath = await findBirda();
        const versionInfo = await validateBirdaVersion(birdaPath, MINIMUM_BIRDA_VERSION);

        if (!versionInfo.meetsMinimum) {
          return {
            available: false,
            error: `birda version ${versionInfo.version} is too old. Minimum required: ${versionInfo.minVersion}\nDownload latest: ${BIRDA_GITHUB_URL}`,
            path: birdaPath,
            version: versionInfo.version,
            minVersion: versionInfo.minVersion,
          };
        }

        return {
          available: true,
          path: birdaPath,
          version: versionInfo.version,
          minVersion: versionInfo.minVersion,
        };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    })();

    cachedVersionCheck = promise;

    // After the promise resolves, if it failed, clear the cache for the next call.
    promise.then((result) => {
      if (!result.available) {
        // Avoid race condition: only clear cache if it's still our failed promise.
        if (cachedVersionCheck === promise) {
          cachedVersionCheck = null;
        }
      }
    });

    return promise;
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
        const parts = line.split(',').map((s: string) => s.trim());
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
