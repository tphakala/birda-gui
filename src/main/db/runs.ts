import { getDb } from './database';
import type { AnalysisRun, FinishedRunStatus, RunWithStats } from '$shared/types';

export function createRun(
  sourcePath: string,
  model: string,
  minConfidence: number,
  locationId?: number | null,
  settingsJson?: string | null,
  timezoneOffsetMin?: number | null,
): AnalysisRun {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO analysis_runs (location_id, source_path, model, min_confidence, settings_json, timezone_offset_min, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now'))
  `);
  const result = stmt.run(
    locationId ?? null,
    sourcePath,
    model,
    minConfidence,
    settingsJson ?? null,
    timezoneOffsetMin ?? null,
  );
  const run = getRunById(result.lastInsertRowid as number);
  if (!run) throw new Error('Failed to create run');
  return run;
}

function getRunById(id: number): AnalysisRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as AnalysisRun | undefined;
}

export function deleteRun(id: number): void {
  const db = getDb();
  // detections, audio_files, and (via audio_files) annotations all cascade-delete
  // through their FK ON DELETE CASCADE, so deleting the run row is sufficient.
  db.prepare('DELETE FROM analysis_runs WHERE id = ?').run(id);
}

/** Mark any runs left in 'running' state as 'failed'; they are stale from a previous session. */
export function markStaleRunsAsFailed(): number {
  const db = getDb();
  const result = db
    .prepare("UPDATE analysis_runs SET status = 'failed', completed_at = datetime('now') WHERE status = 'running'")
    .run();
  return result.changes;
}

export function getRunsWithStats(): RunWithStats[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT
      ar.*,
      COUNT(DISTINCT d.id) as detection_count,
      COUNT(DISTINCT af.id) as file_count,
      l.name as location_name,
      l.latitude,
      l.longitude
    FROM analysis_runs ar
    LEFT JOIN detections d ON ar.id = d.run_id
    LEFT JOIN audio_files af ON ar.id = af.run_id
    LEFT JOIN locations l ON ar.location_id = l.id
    GROUP BY ar.id
    ORDER BY ar.started_at DESC
  `,
    )
    .all() as (RunWithStats & { file_count: number })[];

  // Derive is_directory from file_count
  return rows.map((row) => ({
    ...row,
    is_directory: row.file_count > 1,
  }));
}

/** What finishRun did to other results for the same source and model. */
export interface FinishRunEffect {
  /** Earlier runs deleted because this run replaced them. */
  replaced: number;
  /** This run's own detections were deleted because an earlier complete result exists. */
  discardedPartial: boolean;
}

/**
 * Records the status a run ended with and keeps one result set per source and
 * model, so no detection is counted twice:
 * - A completed run replaces every earlier finished run for the same source
 *   and model (their detections, audio files and annotations cascade), unless
 *   replaceEarlier is false because the run analysed no files.
 * - A cancelled or failed run keeps its partial detections only when no earlier
 *   completed run exists; otherwise they are deleted and the run is kept as a
 *   record with no results.
 */
export function finishRun(id: number, status: FinishedRunStatus, replaceEarlier = true): FinishRunEffect {
  const db = getDb();

  return db.transaction((): FinishRunEffect => {
    db.prepare("UPDATE analysis_runs SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, id);
    const run = getRunById(id);
    if (!run) return { replaced: 0, discardedPartial: false };

    if (status === 'completed' || status === 'completed_with_errors') {
      if (!replaceEarlier) return { replaced: 0, discardedPartial: false };
      const { changes } = db
        .prepare(
          "DELETE FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status NOT IN ('pending', 'running')",
        )
        .run(run.source_path, run.model, run.id);
      return { replaced: changes, discardedPartial: false };
    }

    const earlierComplete = db
      .prepare(
        "SELECT 1 FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status IN ('completed', 'completed_with_errors')",
      )
      .get(run.source_path, run.model, run.id);
    if (!earlierComplete) return { replaced: 0, discardedPartial: false };
    // Detections and annotations cascade from audio_files.
    db.prepare('DELETE FROM audio_files WHERE run_id = ?').run(run.id);
    return { replaced: 0, discardedPartial: true };
  })();
}
