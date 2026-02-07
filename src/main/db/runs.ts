import { getDb } from './database';
import type { AnalysisRun, RunWithStats } from '$shared/types';

export function createRun(
  sourcePath: string,
  model: string,
  minConfidence: number,
  locationId?: number | null,
  settingsJson?: string | null,
): AnalysisRun {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO analysis_runs (location_id, source_path, model, min_confidence, settings_json, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', datetime('now'))
  `);
  const result = stmt.run(locationId ?? null, sourcePath, model, minConfidence, settingsJson ?? null);
  return getRunById(result.lastInsertRowid as number)!;
}

export function updateRunStatus(id: number, status: AnalysisRun['status']): void {
  const db = getDb();
  if (status === 'completed' || status === 'failed') {
    db.prepare("UPDATE analysis_runs SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, id);
  } else {
    db.prepare('UPDATE analysis_runs SET status = ? WHERE id = ?').run(status, id);
  }
}

function getRunById(id: number): AnalysisRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as AnalysisRun | undefined;
}

export function findCompletedRuns(sourcePath: string, model: string): AnalysisRun[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM analysis_runs WHERE source_path = ? AND model = ? AND status = 'completed' ORDER BY completed_at DESC",
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
  return db
    .prepare(
      `SELECT
        r.*,
        COALESCE(d.cnt, 0) AS detection_count,
        l.name AS location_name
      FROM analysis_runs r
      LEFT JOIN (
        SELECT run_id, COUNT(*) AS cnt FROM detections GROUP BY run_id
      ) d ON d.run_id = r.id
      LEFT JOIN locations l ON l.id = r.location_id
      ORDER BY r.started_at DESC`,
    )
    .all() as RunWithStats[];
}
