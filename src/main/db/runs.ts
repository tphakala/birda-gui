import { getDb } from './database';
import type { AnalysisRun, FinishedRunStatus, RunWithStats } from '$shared/types';
import { COMPLETE_RUN_STATUSES, PARTIAL_RUN_STATUSES } from '$shared/constants';
import { sqlList } from './schema';
import { parseRecordingName } from '$shared/recording-name';
import { formatIsoWithOffset, zonedWallToUtc } from '$shared/time-zone';

export function createRun(
  sourcePath: string,
  model: string,
  minConfidence: number,
  locationId?: number | null,
  settingsJson?: string | null,
  timezoneOffsetMin?: number | null,
  timezone?: string | null,
): AnalysisRun {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO analysis_runs (location_id, source_path, model, min_confidence, settings_json, timezone_offset_min, timezone, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running', datetime('now'))
  `);
  const result = stmt.run(
    locationId ?? null,
    sourcePath,
    model,
    minConfidence,
    settingsJson ?? null,
    timezoneOffsetMin ?? null,
    timezone ?? null,
  );
  const run = getRunById(result.lastInsertRowid as number);
  if (!run) throw new Error('Failed to create run');
  return run;
}

function getRunById(id: number): AnalysisRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as AnalysisRun | undefined;
}

/** Records why birda ran without the range filter. */
export function setRunRangeFilterNote(id: number, note: string): void {
  getDb().prepare('UPDATE analysis_runs SET range_filter_note = ? WHERE id = ?').run(note, id);
}

/**
 * Sets the zone a run's file name timestamps are read in and recomputes the
 * recording start and offset of each file whose start came from its name.
 * Header and untimed files are left alone. Returns how many files changed.
 */
export function setRunTimezone(runId: number, timezone: string): number {
  const db = getDb();
  return db.transaction(() => {
    db.prepare('UPDATE analysis_runs SET timezone = ? WHERE id = ?').run(timezone, runId);
    const files = db
      .prepare("SELECT id, file_name FROM audio_files WHERE run_id = ? AND timestamp_source = 'filename'")
      .all(runId) as { id: number; file_name: string }[];
    const update = db.prepare('UPDATE audio_files SET recording_start = ?, timezone_offset_min = ? WHERE id = ?');
    let changed = 0;
    for (const file of files) {
      const wall = parseRecordingName(file.file_name, { allowSuffix: true });
      if (!wall) continue;
      const { instantMs, offsetMin } = zonedWallToUtc(wall, timezone);
      update.run(formatIsoWithOffset(instantMs, offsetMin), offsetMin, file.id);
      changed++;
    }
    return changed;
  })();
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

/** Every distinct source path (file or folder) that an analysis run was started on. */
export function getAnalysisSourcePaths(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT source_path FROM analysis_runs').all() as { source_path: string }[];
  return rows.map((r) => r.source_path);
}

export function getRunsWithStats(): RunWithStats[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT
      ar.*,
      (SELECT COUNT(*) FROM detections d WHERE d.run_id = ar.id) as detection_count,
      (SELECT COUNT(*) FROM audio_files af WHERE af.run_id = ar.id) as file_count,
      (SELECT COUNT(datetime(recording_start)) FROM audio_files af WHERE af.run_id = ar.id) as timed_file_count,
      (SELECT COALESCE(SUM(timestamp_source = 'filename'), 0) FROM audio_files af WHERE af.run_id = ar.id) as filename_file_count,
      (SELECT MIN(datetime(recording_start)) FROM audio_files af WHERE af.run_id = ar.id) as first_recording_start,
      (SELECT MAX(datetime(recording_start)) FROM audio_files af WHERE af.run_id = ar.id) as last_recording_start,
      l.name as location_name,
      l.latitude,
      l.longitude
    FROM analysis_runs ar
    LEFT JOIN locations l ON ar.location_id = l.id
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
  /** This run had detections, and they were deleted because an earlier complete result exists. */
  discardedPartial: boolean;
}

const COMPLETE = sqlList(COMPLETE_RUN_STATUSES);
const PARTIAL = sqlList(PARTIAL_RUN_STATUSES);

/**
 * Records the status a run ended with and keeps one result set per source and
 * model, so no detection is counted twice. Other runs are touched only when
 * they are earlier (lower id) and finished; deleting a run cascades to its
 * detections, audio files and annotations. "Results" means detections, and a
 * complete result is a completed run that analysed at least one file.
 * - A completed run replaces every earlier finished run, unless replaceEarlier
 *   is false because it analysed no files.
 * - A cancelled or failed run deletes its own partial results when an earlier
 *   complete result exists, and stays as a record with no results.
 * - Otherwise a cancelled or failed run with results replaces earlier
 *   cancelled and failed runs; one without results replaces nothing.
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

    const hasResults = db.prepare('SELECT 1 FROM detections WHERE run_id = ? LIMIT 1').get(id) !== undefined;
    const earlierComplete = db
      .prepare(
        `SELECT 1 FROM analysis_runs r WHERE source_path = ? AND model = ? AND id < ? AND status IN (${COMPLETE})
           AND EXISTS (SELECT 1 FROM audio_files WHERE run_id = r.id)`,
      )
      .get(...sameSource);
    if (earlierComplete) {
      // Detections and annotations cascade from audio_files.
      db.prepare('DELETE FROM audio_files WHERE run_id = ?').run(id);
      return { replaced: 0, discardedPartial: hasResults };
    }
    if (!hasResults) return none;
    const { changes } = db
      .prepare(`DELETE FROM analysis_runs WHERE source_path = ? AND model = ? AND id < ? AND status IN (${PARTIAL})`)
      .run(...sameSource);
    return { replaced: changes, discardedPartial: false };
  })();
}
