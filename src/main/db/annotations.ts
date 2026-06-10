import { getDb } from './database';
import type { Annotation, AnnotationInput } from '$shared/types';

const ANNOTATION_COLUMNS = `id, audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
       scientific_name, confidence, source, status, created_at, updated_at`;

/** All annotations for an audio file, oldest first. Includes rejected rows; the renderer filters them. */
export function listAnnotations(audioFileId: number): Annotation[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT ${ANNOTATION_COLUMNS}
       FROM annotations
       WHERE audio_file_id = ?
       ORDER BY start_time ASC, id ASC`,
    )
    .all(audioFileId) as Annotation[];
}

/** Insert (no id) or update (id present); returns the persisted row. */
export function upsertAnnotation(input: AnnotationInput): Annotation {
  if (!(input.end_time > input.start_time)) {
    throw new Error(
      `Invalid annotation range: start_time ${input.start_time} must be before end_time ${input.end_time}`,
    );
  }
  const db = getDb();
  const detectionId = input.detection_id ?? null;
  const lowFreq = input.low_freq_hz ?? null;
  const highFreq = input.high_freq_hz ?? null;
  const confidence = input.confidence ?? null;

  if (input.id !== undefined) {
    const row = db
      .prepare(
        `UPDATE annotations
         SET detection_id = ?, start_time = ?, end_time = ?, low_freq_hz = ?, high_freq_hz = ?,
             scientific_name = ?, confidence = ?, source = ?, status = ?, updated_at = datetime('now')
         WHERE id = ?
         RETURNING ${ANNOTATION_COLUMNS}`,
      )
      .get(
        detectionId,
        input.start_time,
        input.end_time,
        lowFreq,
        highFreq,
        input.scientific_name,
        confidence,
        input.source,
        input.status,
        input.id,
      ) as Annotation | undefined;
    if (!row) throw new Error(`Annotation ${input.id} no longer exists; it may have been deleted`);
    return row;
  }

  return db
    .prepare(
      `INSERT INTO annotations
         (audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
          scientific_name, confidence, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${ANNOTATION_COLUMNS}`,
    )
    .get(
      input.audio_file_id,
      detectionId,
      input.start_time,
      input.end_time,
      lowFreq,
      highFreq,
      input.scientific_name,
      confidence,
      input.source,
      input.status,
    ) as Annotation;
}

export function deleteAnnotation(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}

/** Resolve an audio_files.id by file path (optionally scoped to a run). Returns null if unknown. */
export function getAudioFileIdByPath(filePath: string, runId?: number | null): number | null {
  const db = getDb();
  const row =
    runId !== null && runId !== undefined
      ? (db
          .prepare('SELECT id FROM audio_files WHERE file_path = ? AND run_id = ? ORDER BY id DESC LIMIT 1')
          .get(filePath, runId) as { id: number } | undefined)
      : (db.prepare('SELECT id FROM audio_files WHERE file_path = ? ORDER BY id DESC LIMIT 1').get(filePath) as
          | { id: number }
          | undefined);
  return row?.id ?? null;
}
