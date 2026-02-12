import { getDb } from './database';
import type { AnalysisRun, RunWithStats } from '$shared/types';

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
  return getRunById(result.lastInsertRowid as number)!;
}

export function updateRunStatus(id: number, status: AnalysisRun['status']): void {
  const db = getDb();
  if (status === 'completed' || status === 'failed' || status === 'completed_with_errors') {
    db.prepare("UPDATE analysis_runs SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, id);
  } else {
    db.prepare('UPDATE analysis_runs SET status = ? WHERE id = ?').run(status, id);
  }
}

function getRunById(id: number): AnalysisRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as AnalysisRun | undefined;
}

function findCompletedRuns(sourcePath: string, model: string): AnalysisRun[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM analysis_runs WHERE source_path = ? AND model = ? AND status IN ('completed', 'completed_with_errors') ORDER BY completed_at DESC",
    )
    .all(sourcePath, model) as AnalysisRun[];
}

export function deleteRun(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM detections WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM analysis_runs WHERE id = ?').run(id);
  })();
}

/** Mark any runs left in 'running' state as 'failed' — they are stale from a previous session. */
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

export function deleteCompletedRunsForSource(sourcePath: string, model: string): number {
  const db = getDb();

  return db.transaction(() => {
    const runs = findCompletedRuns(sourcePath, model);
    for (const run of runs) {
      deleteRun(run.id);
    }
    return runs.length;
  })();
}
