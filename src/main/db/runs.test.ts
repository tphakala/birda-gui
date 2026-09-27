import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCatalog } from './database';
import { createRun, finishRun } from './runs';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));

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
function runWithResults(source: string, model: string, status: string): number {
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

// Rows left in the tables a run's deletion cascades to: audio files, detections, annotations.
function resultRows(): number[] {
  const row = db()
    .prepare(
      'SELECT (SELECT COUNT(*) FROM audio_files) AS f, (SELECT COUNT(*) FROM detections) AS d, (SELECT COUNT(*) FROM annotations) AS a',
    )
    .get() as { f: number; d: number; a: number };
  return [row.f, row.d, row.a];
}

describe('finishRun', () => {
  it('replaces earlier completed runs for the same source and model once the new run completes', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const withErrors = runWithResults('/rec', 'birdnet', 'completed_with_errors');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed')).toBe(2);
    expect(runIds()).toEqual([current]);
    expect(status(current)).toBe('completed');
    expect(status(earlier)).toBeUndefined();
    expect(status(withErrors)).toBeUndefined();
    expect(resultRows()).toEqual([0, 0, 0]);
  });

  it('also replaces them when the new run completes with errors', () => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed_with_errors')).toBe(1);
    expect(runIds()).toEqual([current]);
    expect(status(earlier)).toBeUndefined();
  });

  it.each(['cancelled', 'failed'] as const)('keeps earlier results when the new run is %s', (finalStatus) => {
    const earlier = runWithResults('/rec', 'birdnet', 'completed');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, finalStatus)).toBe(0);
    expect(runIds()).toEqual([earlier, current]);
    expect(status(current)).toBe(finalStatus);
    expect(resultRows()).toEqual([1, 1, 1]);
  });

  it('keeps runs of another source or model, and earlier runs that did not complete', () => {
    const otherSource = runWithResults('/other', 'birdnet', 'completed');
    const otherModel = runWithResults('/rec', 'perch', 'completed');
    const cancelled = runWithResults('/rec', 'birdnet', 'cancelled');
    const failed = runWithResults('/rec', 'birdnet', 'failed');
    const current = createRun('/rec', 'birdnet', 0.1).id;

    expect(finishRun(current, 'completed')).toBe(0);
    expect(runIds()).toEqual([otherSource, otherModel, cancelled, failed, current]);
  });

  it('sets completed_at on every finished status', () => {
    const current = createRun('/rec', 'birdnet', 0.1).id;
    finishRun(current, 'cancelled');
    const row = db().prepare('SELECT completed_at FROM analysis_runs WHERE id = ?').get(current) as {
      completed_at: string | null;
    };
    expect(row.completed_at).not.toBeNull();
  });
});
