import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '$shared/types';

const SETTINGS_FILE = 'birda-gui-settings.json';

export function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  const defaults: AppSettings = {
    birda_path: '',
    clip_output_dir: path.join(app.getPath('userData'), 'clips'),
    db_path: path.join(app.getPath('userData'), 'birda-catalog.db'),
    default_model: 'birdnet-v24',
    default_confidence: 0.1,
    default_execution_provider: 'auto',
    default_freq_max: 15000,
    default_spectrogram_height: 160,
    species_language: 'en',
    ui_language: 'en',
    theme: 'system',
    setup_completed: false,
  };

  try {
    const raw = await fs.promises.readFile(settingsPath, 'utf-8');
    return { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(settings, null, 2));
  await fs.promises.rename(tmpPath, settingsPath);
}
