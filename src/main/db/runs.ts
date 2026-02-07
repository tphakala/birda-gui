import { getDb } from './database';
import type { AnalysisRun } from '$shared/types';

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
