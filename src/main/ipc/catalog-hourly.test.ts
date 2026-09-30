import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HourlyDetectionCell } from '$shared/types';
import { invoke, resetIpc } from '../test-support/ipc-harness';

const conn = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);
vi.mock('./analysis', () => ({ isAnalysisActive: () => false, activeRunId: () => null }));
vi.mock('../labels/label-service', () => ({
  resolveAll: (names: string[]) => new Map(names.map((n) => [n, `common ${n}`])),
  searchByCommonName: () => [],
}));
vi.mock('../db/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/database')>()),
  getDb: () => {
    if (!conn.db) throw new Error('no test catalog');
    return conn.db;
  },
}));

const { initializeCatalog } = await import('../db/database');
const { registerCatalogHandlers } = await import('./catalog');
registerCatalogHandlers();

function db(): Database.Database {
  if (!conn.db) throw new Error('no test catalog');
  return conn.db;
}

beforeEach(() => {
  resetIpc();
  conn.db = new Database(':memory:');
  initializeCatalog(conn.db);
  db().prepare("INSERT INTO analysis_runs (source_path, model, status) VALUES ('/rec', 'birdnet', 'completed')").run();
});

afterEach(() => {
  conn.db?.close();
  conn.db = null;
});

function addFile(name: string): number {
  return Number(
    db().prepare("INSERT INTO audio_files (run_id, file_path, file_name) VALUES (1, ?, 'f')").run(`/rec/${name}`)
      .lastInsertRowid,
  );
}

function addDetection(fileId: number, species: string, start: number): void {
  db()
    .prepare(
      'INSERT INTO detections (run_id, audio_file_id, start_time, end_time, scientific_name, confidence) VALUES (1, ?, ?, ?, ?, 0.9)',
    )
    .run(fileId, start, start + 3, species);
}

function cells(): HourlyDetectionCell[] {
  return invoke('catalog:get-hourly-detections', {}) as HourlyDetectionCell[];
}

describe('catalog:get-hourly-detections', () => {
  it('counts by wall-clock hour from a suffixed recording name and the offset', () => {
    const file = addFile('20240501_053000_A.wav');
    for (const start of [0, 1799, 1800, 5400]) addDetection(file, 'Turdus merula', start);

    const byHour = Object.fromEntries(cells().map((c) => [c.hour, c.detection_count]));
    expect(byHour).toEqual({ 5: 2, 6: 1, 7: 1 });
  });

  it('uses the offset alone when the name has no date', () => {
    const file = addFile('recording.wav');
    addDetection(file, 'Turdus merula', 10);
    addDetection(file, 'Turdus merula', 3700);

    expect(cells().map((c) => [c.hour, c.detection_count])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('returns one cell per species and hour with the common name', () => {
    const file = addFile('20240501_053000_A.wav');
    addDetection(file, 'Turdus merula', 0);
    addDetection(file, 'Parus major', 0);

    const result = cells().sort((a, b) => a.scientific_name.localeCompare(b.scientific_name));
    expect(result).toEqual([
      { scientific_name: 'Parus major', common_name: 'common Parus major', hour: 5, detection_count: 1 },
      { scientific_name: 'Turdus merula', common_name: 'common Turdus merula', hour: 5, detection_count: 1 },
    ]);
  });
});
