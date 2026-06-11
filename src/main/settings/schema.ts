import { z } from 'zod';

/**
 * Shared Zod schema for app settings validation.
 *
 * `.partial()` so it validates both partial updates from the renderer and
 * settings files that omit keys (defaults fill the rest). The IPC layer adds
 * `.strict()` to reject unknown properties from untrusted renderer input; the
 * file loader keeps the base (non-strict) schema so legacy/unknown keys in a
 * hand-edited file are stripped rather than rejected.
 */
export const PartialSettingsSchema = z
  .object({
    birda_path: z.string(),
    clip_output_dir: z.string(),
    db_path: z.string(),
    default_confidence: z.number().min(0).max(1),
    default_execution_provider: z.string(),
    default_freq_max: z.number().int().positive(),
    default_spectrogram_height: z.number().int().positive(),
    species_language: z.string(),
    ui_language: z.string(),
    theme: z.enum(['system', 'light', 'dark']),
    setup_completed: z.boolean(),
  })
  .partial();
