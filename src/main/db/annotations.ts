import { getDb } from './database';
import type { Annotation, AnnotationInput } from '$shared/types';

/** All annotations for an audio file, oldest first. Includes rejected rows; the renderer filters them. */
export function listAnnotations(audioFileId: number): Annotation[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
              scientific_name, confidence, source, status, created_at, updated_at
       FROM annotations
       WHERE audio_file_id = ?
       ORDER BY start_time ASC, id ASC`,
    )
    .all(audioFileId) as Annotation[];
}

function getById(id: number): Annotation {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
              scientific_name, confidence, source, status, created_at, updated_at
       FROM annotations WHERE id = ?`,
    )
    .get(id) as Annotation | undefined;
  if (!row) throw new Error(`Annotation ${id} not found`);
  return row;
}

/** Insert (no id) or update (id present); returns the persisted row. */
export function upsertAnnotation(input: AnnotationInput): Annotation {
  const db = getDb();
  const detectionId = input.detection_id ?? null;
  const lowFreq = input.low_freq_hz ?? null;
  const highFreq = input.high_freq_hz ?? null;
  const confidence = input.confidence ?? null;

  if (input.id !== undefined) {
    db.prepare(
      `UPDATE annotations
       SET detection_id = ?, start_time = ?, end_time = ?, low_freq_hz = ?, high_freq_hz = ?,
           scientific_name = ?, confidence = ?, source = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
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
    );
    return getById(input.id);
  }

  const result = db
    .prepare(
      `INSERT INTO annotations
         (audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
          scientific_name, confidence, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return getById(Number(result.lastInsertRowid));
}

export function deleteAnnotation(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}
