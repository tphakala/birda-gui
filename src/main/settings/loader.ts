import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '$shared/types';
import { PartialSettingsSchema } from './schema';

const SETTINGS_FILE = 'birda-gui-settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

/** settings.json.corrupt-<UTC time>, with -1, -2, ... added when that name is taken, so no earlier backup is overwritten. */
async function uniqueCorruptPath(settingsPath: string): Promise<string> {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const base = `${settingsPath}.corrupt-${stamp}`;
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    try {
      await fs.promises.access(candidate);
    } catch {
      return candidate;
    }
  }
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

  let raw: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    raw = await fs.promises.readFile(settingsPath, 'utf-8');
  } catch (err) {
    // No file yet is the normal first launch. Any other read error leaves the
    // file alone: it may be fine and only unreadable for now.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Could not read settings from ${settingsPath}; using defaults.`, err);
    }
    return defaults;
  }

  let parsed: Record<string, unknown>;
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new SyntaxError('settings file does not contain a JSON object');
    }
    parsed = json as Record<string, unknown>;
  } catch (err) {
    // Move the broken file aside so the next save does not overwrite the only copy.
    try {
      const corruptPath = await uniqueCorruptPath(settingsPath);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.promises.rename(settingsPath, corruptPath);
      console.error(`Settings file is not valid; moved it to ${corruptPath} and using defaults.`, err);
    } catch (renameErr) {
      console.error(`Settings file is not valid and could not be moved aside; using defaults.`, err, renameErr);
    }
    return defaults;
  }

  // Validate the read path so a hand-edited file with a wrong-typed value
  // (e.g. default_freq_max: 0) cannot flow unvalidated into the renderer.
  // Validate per field so one bad value only drops that field (falling back to
  // its default) rather than discarding the whole file. Unknown/legacy keys
  // (e.g. the deprecated default_model) have no schema entry and are skipped.
  const shape = PartialSettingsSchema.shape;
  const valid: Record<string, unknown> = {};
  /* eslint-disable security/detect-object-injection -- keys come from Object.entries and are gated by `key in shape` against a fixed schema */
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(shape, key)) continue; // unknown/legacy/inherited key (e.g. deprecated default_model): ignore
    const field = shape[key as keyof typeof shape].safeParse(value);
    if (field.success) {
      valid[key] = field.data;
    } else {
      console.warn(`Ignoring invalid settings value for "${key}" in ${settingsPath}.`, field.error.issues);
    }
  }
  /* eslint-enable security/detect-object-injection */
  return { ...defaults, ...(valid as Partial<AppSettings>) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.promises.writeFile(tmpPath, JSON.stringify(settings, null, 2));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.promises.rename(tmpPath, settingsPath);
}
