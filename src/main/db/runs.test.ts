import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishedRunStatus, RunStatus } from '$shared/types';
import { initializeCatalog } from './database';
import { createRun, finishRun, markStaleRunsAsFailed } from './runs';
import { getCatalogStats, getSpeciesSummary } from './detections';

// A userData directory that does not exist, so a real getDb() reached by a
// broken mock fails instead of creating a catalog in the working directory.
vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'birda-gui-test-no-such-dir', 'userData') },
}));

const conn = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  getDb: () => {
    if (!conn.db) throw new Error('no test catalog');
    return conn.db;
  },
}));

function db(): Database.Database {
  if (!conn.db) throw new Error('no test catalog');
  return conn.db;
}

beforeEach(() => {
  conn.db = new Database(':memory:');
  initializeCatalog(conn.db);
});

afterEach(() => {
  conn.db?.close();
  conn.db = null;
});

// A run with one audio file, detection and annotation, so cascades are visible.
function runWithResults(source: string, model: string, status: RunStatus): number {
  const run = createRun(source, model, 0.1);
  db().prepare('UPDATE analysis_runs SET status = ? WHERE id = ?').run(status, run.id);
  const file = db()
    .prepare("INSERT INTO audio_files (run_id, file_path, file_name) VALUES (?, ?, 'a.wav')")
    .run(run.id, `${source}/a.wav`);
  const detection = db()
    .prepare(
      "INSERT INTO detections (run_id, audio_file_id, start_time, end_time, scientific_name, confidence) VALUES (?, ?, 0, 3, 'Turdus merula', 0.9)",
    )
    .run(run.id, file.lastInsertRowid);
  db()
    .prepare(
      "INSERT INTO annotations (audio_file_id, detection_id, start_time, end_time, scientific_name, source, status) VALUES (?, ?, 0, 3, 'Turdus merula', 'birda', 'accepted')",
    )
    .run(file.lastInsertRowid, detection.lastInsertRowid);
  return run.id;
}

function runIds(): number[] {
  return (db().prepare('SELECT id FROM analysis_runs ORDER BY id').all() as { id: number }[]).map((r) => r.id);
}

function status(id: number): string | undefined {
  return (db().prepare('SELECT status FROM analysis_runs WHERE id = ?').get(id) as { status: string } | undefined)
    ?.status;
}

// Rows per run in the tables a run's results live in: audio files, detections, annotations.
function resultRows(runId: number): number[] {
  const row = db()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM audio_files WHERE run_id = ?) AS f,
              (SELECT COUNT(*) FROM detections WHERE run_id = ?) AS d,
              (SELECT COUNT(*) FROM annotations a JOIN audio_files af ON af.id = a.audio_file_id WHERE af.run_id = ?) AS a`,
    )
    .get(runId, runId, runId) as { f: number; d: number; a: number };
  return [row.f, row.d, row.a];
}

describe('finishRun', () => {
  it.each(['completed', 'completed_with_errors'] as const)(
    'replaces every earlier finished run for the same source and model when the new run is %s',
    (finalStatus) => {
      const earlier = [
        runWithResults('/rec', 'birdnet', 'completed'),
        runWithResults('/rec', 'birdnet', 'completed_with_errors'),
        runWithResults('/rec', 'birdnet', 'cancelled'),
        runWithResults('/rec', 'birdnet', 'failed'),
      ];
      const current = createRun('/rec', 'birdnet', 0.1).id;

      expect(finishRun(current, finalStatus)).toEqual({ replaced: 4, discardedPartial: false });
      expect(runIds()).toEqual([current]);
      expect(status(current)).toBe(finalStatus);
      for (const id of earlier) expect(resultRows(id)).toEqual([0, 0, 0]);
    },
  );

  it('keeps earlier runs when the completed run analysed no files', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed', false)).toEqual({ replaced: 0, discardedPartial: false });
    expect(runIds()).toEqual([earlier, current]);
    expect(resultRows(earlier)).toEqual([1, 1, 1]);
  });

  it('keeps runs of another source or model, and runs still in progress', () => {
    const otherSource = runWithResults('/other', 'birdnet', 'completed');
    const otherModel = runWithResults('/rec', 'perch', 'completed');
    const running = runWithResults('/rec', 'birdnet', 'running');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed')).toEqual({ replaced: 0, discardedPartial: false });
    expect(runIds()).toEqual([otherSource, otherModel, running, current]);
  });

  it('never replaces a later run', () => {
    const current = createRun('/rec', 'birdnet', 0.1).id;
    const later = runWithResults('/rec', 'birdnet', 'completed');

    expect(finishRun(current, 'completed')).toEqual({ replaced: 0, discardedPartial: false });
    expect(runIds()).toEqual([current, later]);
  });

  it.each(['cancelled', 'failed'] as const)(
    'drops a %s run’s partial results when an earlier complete result exists',
    (finalStatus) => {
      const earlier = runWithResults('/rec', 'birdnet', 'completed');
      const current = runWithResults('/rec', 'birdnet', 'running');

      expect(finishRun(current, finalStatus)).toEqual({ replaced: 0, discardedPartial: true });
      expect(runIds()).toEqual([earlier, current]);
      expect(status(current)).toBe(finalStatus);
      expect(resultRows(current)).toEqual([0, 0, 0]);
      expect(resultRows(earlier)).toEqual([1, 1, 1]);
    },
  );

  it.each(['cancelled', 'failed'] as const)(
    'keeps a %s run’s partial results and replaces earlier partial runs when no complete result exists',
    (finalStatus) => {
      const earlierFailed = runWithResults('/rec', 'birdnet', 'failed');
      const earlierCancelled = runWithResults('/rec', 'birdnet', 'cancelled');
      const current = runWithResults('/rec', 'birdnet', 'running');

      expect(finishRun(current, finalStatus)).toEqual({ replaced: 2, discardedPartial: false });
      expect(runIds()).toEqual([current]);
      expect(resultRows(current)).toEqual([1, 1, 1]);
      expect(resultRows(earlierFailed)).toEqual([0, 0, 0]);
      expect(resultRows(earlierCancelled)).toEqual([0, 0, 0]);
    },
  );

  it.each(['cancelled', 'failed'] as const)(
    'keeps earlier partial runs when a %s run has no results of its own',
    (finalStatus) => {
      const earlier = runWithResults('/rec', 'birdnet', 'cancelled');
      db()
        .prepare(
          "INSERT INTO annotations (audio_file_id, start_time, end_time, scientific_name, source, status) SELECT id, 5, 6, 'Parus major', 'manual', 'manual' FROM audio_files WHERE run_id = ?",
        )
        .run(earlier);
      const current = createRun('/rec', 'birdnet', 0.1).id;

      expect(finishRun(current, finalStatus)).toEqual({ replaced: 0, discardedPartial: false });
      expect(runIds()).toEqual([earlier, current]);
      expect(resultRows(earlier)).toEqual([1, 1, 2]);
    },
  );

  it('keeps earlier partial runs when a completed run analysed no files', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'failed');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed', false)).toEqual({ replaced: 0, discardedPartial: false });
    expect(runIds()).toEqual([earlier, current]);
  });

  it('drops a partial run’s results when the earlier result completed with errors', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed_with_errors');
    const current = runWithResults('/rec', 'birdnet', 'running');

    expect(finishRun(current, 'cancelled')).toEqual({ replaced: 0, discardedPartial: true });
    expect(resultRows(earlier)).toEqual([1, 1, 1]);
  });

  it('keeps a partial run’s results when the only complete result is later or for another source or model', () => {
    runWithResults('/other', 'birdnet', 'completed');
    runWithResults('/rec', 'perch', 'completed');
    const current = runWithResults('/rec', 'birdnet', 'running');
    const later = runWithResults('/rec', 'birdnet', 'completed');

    expect(finishRun(current, 'cancelled')).toEqual({ replaced: 0, discardedPartial: false });
    expect(resultRows(current)).toEqual([1, 1, 1]);
    expect(resultRows(later)).toEqual([1, 1, 1]);
  });

  it('never replaces runs that have not finished', () => {
    const pending = runWithResults('/rec', 'birdnet', 'pending');
    const running = runWithResults('/rec', 'birdnet', 'running');
    const completed = createRun('/rec', 'birdnet', 0.1).id;
    const cancelled = createRun('/rec', 'birdnet', 0.1).id;

    finishRun(completed, 'completed');
    finishRun(cancelled, 'cancelled');
    expect(runIds()).toEqual([pending, running, completed, cancelled]);
  });

  it.each(['completed', 'completed_with_errors', 'failed', 'cancelled'] satisfies FinishedRunStatus[])(
    'sets completed_at when the run is %s',
    (finalStatus) => {
      const current = createRun('/rec', 'birdnet', 0.1).id;
      const completedAt = () =>
        (
          db().prepare('SELECT completed_at FROM analysis_runs WHERE id = ?').get(current) as {
            completed_at: string | null;
          }
        ).completed_at;
      expect(completedAt()).toBeNull();

      finishRun(current, finalStatus);
      expect(completedAt()).not.toBeNull();
    },
  );

  it('changes nothing when a replacement fails part way', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const current = createRun('/rec', 'birdnet', 0.1).id;
    db().exec(`
      CREATE TRIGGER block_run_delete BEFORE DELETE ON analysis_runs
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;
    `);

    expect(() => finishRun(current, 'completed')).toThrow('blocked');
    expect(status(current)).toBe('running');
    expect(runIds()).toEqual([earlier, current]);
  });

  it('changes nothing when discarding partial results fails part way', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const current = runWithResults('/rec', 'birdnet', 'running');
    db().exec(`
      CREATE TRIGGER block_file_delete BEFORE DELETE ON audio_files
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;
    `);

    expect(() => finishRun(current, 'cancelled')).toThrow('blocked');
    expect(status(current)).toBe('running');
    expect(resultRows(current)).toEqual([1, 1, 1]);
    expect(resultRows(earlier)).toEqual([1, 1, 1]);
  });
});

describe('markStaleRunsAsFailed', () => {
  it('fails runs left running and applies the one-result-set rule to them', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const stale = runWithResults('/rec', 'birdnet', 'running');
    const other = runWithResults('/other', 'birdnet', 'running');

    expect(markStaleRunsAsFailed()).toBe(2);
    expect(status(stale)).toBe('failed');
    expect(status(other)).toBe('failed');
    expect(resultRows(stale)).toEqual([0, 0, 0]);
    expect(resultRows(earlier)).toEqual([1, 1, 1]);
    expect(resultRows(other)).toEqual([1, 1, 1]);
  });
});

describe('catalog-wide counts', () => {
  it('count finished runs only, so a re-analysis in progress is not counted twice', () => {
    runWithResults('/rec', 'birdnet', 'completed');
    const running = runWithResults('/rec', 'birdnet', 'running');

    expect(getCatalogStats()).toMatchObject({ total_detections: 1, total_species: 1 });
    expect(getSpeciesSummary()).toMatchObject([{ scientific_name: 'Turdus merula', detection_count: 1 }]);

    finishRun(running, 'completed');
    expect(getCatalogStats()).toMatchObject({ total_detections: 1 });
  });
});
