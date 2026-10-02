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

function addFile(
  name: string,
  recordingStart: string | null,
  offsetMin: number | null = null,
  source: 'header' | 'filename' | null = null,
): number {
  return Number(
    db()
      .prepare(
        "INSERT INTO audio_files (run_id, file_path, file_name, recording_start, timezone_offset_min, timestamp_source) VALUES (1, ?, 'f', ?, ?, ?)",
      )
      .run(`/rec/${name}`, recordingStart, offsetMin, source).lastInsertRowid,
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

const byHour = () => Object.fromEntries(cells().map((c) => [c.hour, c.detection_count]));

describe('catalog:get-hourly-detections', () => {
  it('buckets by the run zone: a Helsinki recording starting at 05:30 local counts at hour 5', () => {
    db().prepare("UPDATE analysis_runs SET timezone = 'Europe/Helsinki' WHERE id = 1").run();
    const file = addFile('20260515_053000.wav', '2026-05-15T05:30:00+03:00', 180);
    for (const start of [0, 1799, 1800, 5400]) addDetection(file, 'Turdus merula', start);

    expect(byHour()).toEqual({ 5: 2, 6: 1, 7: 1 });
  });

  it('buckets by UTC hour in a run without a zone and with offset 0', () => {
    const file = addFile('20240501_053000_A.wav', '2024-05-01T05:30:00Z', 0);
    for (const start of [0, 1799, 1800, 5400]) addDetection(file, 'Turdus merula', start);

    expect(byHour()).toEqual({ 5: 2, 6: 1, 7: 1 });
  });

  it('puts a detection after a DST fall-back inside a long file on the right hour', () => {
    db().prepare("UPDATE analysis_runs SET timezone = 'Europe/Helsinki' WHERE id = 1").run();
    // 23:30Z is 02:30 EEST; the clocks go back at 01:00Z (04:00 EEST to 03:00 EET).
    const file = addFile('long.wav', '2026-10-24T23:30:00Z', 180);
    addDetection(file, 'Turdus merula', 7200); // 01:30Z is 03:30 EET, not 04:30

    expect(byHour()).toEqual({ 3: 1 });
  });

  it("uses an AudioMoth header file's own offset in a run without a zone", () => {
    const file = addFile('AM.wav', '2026-05-15T05:30:00+03:00', 180);
    addDetection(file, 'Turdus merula', 0);

    expect(byHour()).toEqual({ 5: 1 });
  });

  it("keeps an AudioMoth header file's own offset in a run that has a zone", () => {
    db().prepare("UPDATE analysis_runs SET timezone = 'UTC' WHERE id = 1").run();
    const header = addFile('AM.wav', '2026-05-15T05:30:00+03:00', 180, 'header');
    const named = addFile('20260515_053000.wav', '2026-05-15T05:30:00Z', 0, 'filename');
    addDetection(header, 'Turdus merula', 0);
    addDetection(named, 'Parus major', 0);

    expect(cells().map((c) => [c.scientific_name, c.hour])).toEqual(
      expect.arrayContaining([
        ['Turdus merula', 5],
        ['Parus major', 5],
      ]),
    );
  });

  it('leaves out a file whose recording start cannot be parsed', () => {
    const broken = addFile('broken.wav', 'not a time', 0, 'filename');
    const timed = addFile('20240501_053000.wav', '2024-05-01T05:30:00Z', 0, 'filename');
    addDetection(broken, 'Turdus merula', 10);
    addDetection(timed, 'Turdus merula', 10);

    expect(byHour()).toEqual({ 5: 1 });
  });

  it('leaves files without a recording start out', () => {
    const untimed = addFile('recording.wav', null);
    const timed = addFile('20240501_053000.wav', '2024-05-01T05:30:00Z', 0);
    addDetection(untimed, 'Turdus merula', 10);
    addDetection(timed, 'Turdus merula', 10);

    expect(byHour()).toEqual({ 5: 1 });
  });

  it('returns one cell per species and hour with the common name', () => {
    const file = addFile('20240501_053000_A.wav', '2024-05-01T05:30:00Z', 0);
    addDetection(file, 'Turdus merula', 0);
    addDetection(file, 'Parus major', 0);

    const result = cells().sort((a, b) => a.scientific_name.localeCompare(b.scientific_name));
    expect(result).toEqual([
      { scientific_name: 'Parus major', common_name: 'common Parus major', hour: 5, detection_count: 1 },
      { scientific_name: 'Turdus merula', common_name: 'common Turdus merula', hour: 5, detection_count: 1 },
    ]);
  });
});
