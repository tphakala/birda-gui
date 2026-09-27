import { getDb } from './database';
import type { AnalysisRun, FinishedRunStatus, RunWithStats } from '$shared/types';
import { COMPLETE_RUN_STATUSES, PARTIAL_RUN_STATUSES } from '$shared/constants';
import { sqlList } from './schema';

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

/**
 * Finishes any runs left in 'running' state as 'failed'; they are stale from a
 * previous session. They go through finishRun, in one transaction, so their
 * partial results follow the same one-result-set rule as a run that failed
 * while the app was open.
 */
export function markStaleRunsAsFailed(): number {
  const db = getDb();
  return db.transaction(() => {
    const stale = db.prepare("SELECT id FROM analysis_runs WHERE status = 'running' ORDER BY id").all() as {
      id: number;
    }[];
    for (const { id } of stale) finishRun(id, 'failed');
    return stale.length;
  })();
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

const COMPLETE = sqlList(COMPLETE_RUN_STATUSES);
const PARTIAL = sqlList(PARTIAL_RUN_STATUSES);

/**
 * Records the status a run ended with and keeps one result set per source and
 * model, so no detection is counted twice. Other runs are touched only when
 * they are earlier (lower id) and finished; deleting a run cascades to its
 * detections, audio files and annotations.
 * - A completed run replaces every earlier finished run, unless replaceEarlier
 *   is false because it analysed no files.
 * - A cancelled or failed run with results replaces earlier cancelled and
 *   failed runs; one without results replaces nothing.
 * - A cancelled or failed run deletes its own partial results when an earlier
 *   completed run exists, and stays as a record with no results.
 */
export function finishRun(id: number, status: FinishedRunStatus, replaceEarlier = true): FinishRunEffect {
  const db = getDb();
  const none: FinishRunEffect = { replaced: 0, discardedPartial: false };

  return db.transaction((): FinishRunEffect => {
    const run = db
      .prepare(
        "UPDATE analysis_runs SET status = ?, completed_at = datetime('now') WHERE id = ? RETURNING source_path, model",
      )
      .get(status, id) as { source_path: string; model: string } | undefined;
    if (!run) return none;
    const sameSource = [run.source_path, run.model, id] as const;

    if ((COMPLETE_RUN_STATUSES as readonly string[]).includes(status)) {
      if (!replaceEarlier) return none;
      const { changes } = db
        .prepare(
          `DELETE FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status IN (${COMPLETE},${PARTIAL})`,
        )
        .run(...sameSource);
      return { replaced: changes, discardedPartial: false };
    }

    const earlierComplete = db
      .prepare(`SELECT 1 FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status IN (${COMPLETE})`)
      .get(...sameSource);
    if (earlierComplete) {
      // Detections and annotations cascade from audio_files.
      db.prepare('DELETE FROM audio_files WHERE run_id = ?').run(id);
      return { replaced: 0, discardedPartial: true };
    }
    const hasResults = db.prepare('SELECT 1 FROM audio_files WHERE run_id = ? LIMIT 1').get(id);
    if (!hasResults) return none;
    const { changes } = db
      .prepare(`DELETE FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status IN (${PARTIAL})`)
      .run(...sameSource);
    return { replaced: changes, discardedPartial: false };
  })();
}
