import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '$shared/types';
import { PartialSettingsSchema } from './schema';

const SETTINGS_FILE = 'birda-gui-settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  const defaults: AppSettings = {
    birda_path: '',
    clip_output_dir: path.join(app.getPath('userData'), 'clips'),
    db_path: path.join(app.getPath('userData'), 'birda-catalog.db'),
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await fs.promises.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Validate the read path so a hand-edited file with a wrong-typed value
    // (e.g. default_freq_max: 0) cannot flow unvalidated into the renderer.
    // Validate per field so one bad value only drops that field (falling back to
    // its default) rather than discarding the whole file. Unknown/legacy keys
    // (e.g. the deprecated default_model) have no schema entry and are skipped.
    const shape = PartialSettingsSchema.shape;
    const valid: Record<string, unknown> = {};
    /* eslint-disable security/detect-object-injection -- keys come from Object.entries and are gated by `key in shape` against a fixed schema */
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in shape)) continue; // unknown/legacy key (e.g. the deprecated default_model): ignore
      const field = shape[key as keyof typeof shape].safeParse(value);
      if (field.success) {
        valid[key] = field.data;
      } else {
        console.warn(`Ignoring invalid settings value for "${key}" in ${settingsPath}.`, field.error.issues);
      }
    }
    /* eslint-enable security/detect-object-injection */
    return { ...defaults, ...(valid as Partial<AppSettings>) };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.promises.writeFile(tmpPath, JSON.stringify(settings, null, 2));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.promises.rename(tmpPath, settingsPath);
}
