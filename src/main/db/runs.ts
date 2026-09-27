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

function updateRunStatus(id: number, status: AnalysisRun['status']): void {
  const db = getDb();
  if (status !== 'pending' && status !== 'running') {
    db.prepare("UPDATE analysis_runs SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, id);
  } else {
    db.prepare('UPDATE analysis_runs SET status = ? WHERE id = ?').run(status, id);
  }
}

function getRunById(id: number): AnalysisRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as AnalysisRun | undefined;
}

function findEarlierCompletedRuns(run: AnalysisRun): AnalysisRun[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM analysis_runs WHERE source_path = ? AND model = ? AND id != ? AND status IN ('completed', 'completed_with_errors')",
    )
    .all(run.source_path, run.model, run.id) as AnalysisRun[];
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

/**
 * Records the status a run ended with. A completed run replaces the earlier
 * completed runs for the same source and model, so re-analysing a source keeps
 * the earlier results until the new run has completed. Returns the number of
 * runs replaced.
 */
export function finishRun(id: number, status: FinishedRunStatus): number {
  const db = getDb();

  return db.transaction(() => {
    updateRunStatus(id, status);
    if (status !== 'completed' && status !== 'completed_with_errors') return 0;
    const run = getRunById(id);
    if (!run) return 0;
    const earlier = findEarlierCompletedRuns(run);
    for (const r of earlier) {
      deleteRun(r.id);
    }
    return earlier.length;
  })();
}
