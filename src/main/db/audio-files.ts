import { getDb } from './database';
import type { AudioFile, AudioFileMetadata } from '$shared/types';
import path from 'path';

/**
 * Create or retrieve existing audio_file record for idempotency.
 * Returns the audio_file_id.
 */
export function createAudioFile(
  runId: number,
  filePath: string,
  metadata: AudioFileMetadata,
): number {
  const db = getDb();

  // Check if already exists (for retry scenarios)
  const existing = db
    .prepare('SELECT id FROM audio_files WHERE run_id = ? AND file_path = ?')
    .get(runId, filePath) as { id: number } | undefined;

  if (existing) return existing.id;

  // Insert new record
  const result = db
    .prepare(
      `
    INSERT INTO audio_files (
      run_id, file_path, file_name, recording_start, timezone_offset_min,
      duration_sec, sample_rate, channels,
      audiomoth_device_id, audiomoth_gain, audiomoth_battery_v, audiomoth_temperature_c
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      runId,
      filePath,
      path.basename(filePath),
      metadata.recording_start,
      metadata.timezone_offset_min,
      metadata.duration_sec,
      metadata.sample_rate,
      metadata.channels,
      metadata.audiomoth_device_id ?? null,
      metadata.audiomoth_gain ?? null,
      metadata.audiomoth_battery_v ?? null,
      metadata.audiomoth_temperature_c ?? null,
    );

  return result.lastInsertRowid as number;
}

/**
 * Get audio file by ID
 */
export function getAudioFile(id: number): AudioFile | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id) as AudioFile) ?? null;
}

/**
 * Get all audio files for a run
 */
export function getRunAudioFiles(runId: number): AudioFile[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM audio_files WHERE run_id = ? ORDER BY file_name ASC')
    .all(runId) as AudioFile[];
}

/**
 * Delete audio files for a run (cascades to detections via FK)
 */
export function deleteAudioFiles(runId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM audio_files WHERE run_id = ?').run(runId);
}
