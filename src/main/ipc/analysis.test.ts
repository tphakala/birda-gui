import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCancelledError } from '../birda/analysis-session';
import { invoke, ipc, resetIpc, sentOn } from '../test-support/ipc-harness';
import type { AnalysisResult, AnalysisStatus, BirdaEventEnvelope } from '$shared/types';

const h = vi.hoisted(() => {
  // A controllable stand-in for runAnalysis's handle.
  function fakeHandle() {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const callbacks: { data?: (e: unknown) => void } = {};
    return {
      promise,
      resolve,
      reject,
      cancel: vi.fn(),
      on(event: string, cb: (...args: never[]) => void) {
        if (event === 'data') callbacks.data = cb as (e: unknown) => void;
      },
      emit(envelope: unknown) {
        callbacks.data?.(envelope);
      },
    };
  }
  return {
    handles: [] as ReturnType<typeof fakeHandle>[],
    fakeHandle,
    settings: { get: vi.fn() },
    nextRunId: 1,
  };
});

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);

vi.mock('../birda/runner', () => ({
  runAnalysis: vi.fn(() => {
    const handle = h.fakeHandle();
    h.handles.push(handle);
    return handle;
  }),
  findBirda: vi.fn(),
}));

vi.mock('../db/runs', () => ({
  createRun: vi.fn(() => ({ id: h.nextRunId++, timezone_offset_min: null })),
  finishRun: vi.fn(() => ({ replaced: 0, discardedPartial: false })),
}));
vi.mock('../db/locations', () => ({ createLocation: vi.fn(), findLocationByCoords: vi.fn() }));
vi.mock('../db/detections', () => ({
  insertDetections: vi.fn(),
  updateDetectionClipPath: vi.fn(),
  importDetectionsFromJson: vi.fn(() => Promise.resolve({ detections: 0, sourceFile: 'x' })),
}));
vi.mock('../db/audio-files', () => ({ createAudioFile: vi.fn(() => 1), deleteAudioFile: vi.fn() }));
vi.mock('../settings/store', () => ({ settingsStore: h.settings }));
vi.mock('./files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./files')>()),
  getAudioMetadata: vi.fn(() => Promise.resolve({ durationSec: 1, sampleRate: 48000, channels: 1, audiomoth: null })),
}));

const { activeRunId, isAnalysisActive, registerAnalysisHandlers, stopAnalysisForQuit } = await import('./analysis');
const { runAnalysis } = await import('../birda/runner');
const { createRun, finishRun } = await import('../db/runs');
const { createLocation, findLocationByCoords } = await import('../db/locations');
const { createAudioFile, deleteAudioFile } = await import('../db/audio-files');
const { importDetectionsFromJson, insertDetections } = await import('../db/detections');
const { getAudioMetadata } = await import('./files');
registerAnalysisHandlers();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-analysis-test-'));
const sourceFile = path.join(tmp, 'rec.wav');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture under a fresh temp dir
fs.writeFileSync(sourceFile, '');

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const analyze = (source = sourceFile, extra: Record<string, unknown> = {}) =>
  invoke('birda:analyze', {
    source_path: source,
    model: 'birdnet',
    min_confidence: 0.1,
    ...extra,
  }) as Promise<AnalysisResult>;

const envelope = (event: string, payload: unknown) => ({ spec_version: '1.1', timestamp: '', event, payload });

// eslint-disable-next-line security/detect-non-literal-fs-filename -- only checks temp dirs the handler created
const exists = (dir: string) => fs.existsSync(dir);

/** The temporary output directory analyze passed to birda. */
function outputDirOf(callIndex = 0): string {
  const options = vi.mocked(runAnalysis).mock.calls.at(callIndex)?.[1] as { outputDir?: string } | undefined;
  if (!options?.outputDir) throw new Error('no output dir');
  return options.outputDir;
}
const cancel = () => invoke('birda:cancel-analysis') as boolean;
const status = () => invoke('birda:analysis-status') as AnalysisStatus;

async function started(count = 1) {
  await vi.waitFor(() => {
    expect(h.handles).toHaveLength(count);
  });
  return h.handles[count - 1];
}

const statusEvents = () => sentOn('birda:analysis-status-changed') as AnalysisStatus[];
const lastStatusEvent = () => statusEvents().at(-1);

/** A promise settled from outside, for holding an await open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Temp directories a test created; removed even when the test fails.
const leftovers: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  h.handles = [];
  resetIpc();
  h.settings.get.mockResolvedValue({ default_execution_provider: 'cpu' });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of leftovers.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('birda:analyze', () => {
  it('keeps the lock through a Stop until the analysis has finished', async () => {
    const run = analyze();
    const handle = await started();

    expect(cancel()).toBe(true);
    expect(handle.cancel).toHaveBeenCalledOnce();
    expect(status()).toMatchObject({ state: 'stopping' });
    await expect(analyze()).rejects.toThrow('still stopping');

    handle.reject(new AnalysisCancelledError());
    await expect(run).resolves.toMatchObject({ status: 'cancelled', discardedPartial: false });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'cancelled', true);
    expect(status()).toEqual({ state: 'idle' });
    expect(lastStatusEvent()).toMatchObject({ state: 'idle', finished: { status: 'cancelled' } });

    const next = analyze();
    (await started(2)).resolve();
    await expect(next).resolves.toMatchObject({ status: 'completed' });
  });

  it('creates no run when stopped during setup', async () => {
    let releaseSettings!: (v: unknown) => void;
    h.settings.get.mockReturnValueOnce(new Promise((r) => (releaseSettings = r)));
    const run = analyze();
    await vi.waitFor(() => {
      expect(h.settings.get).toHaveBeenCalled();
    });

    expect(cancel()).toBe(true);
    releaseSettings({ default_execution_provider: 'cpu' });

    await expect(run).resolves.toEqual({ runId: null, status: 'cancelled', discardedPartial: false });
    expect(createRun).not.toHaveBeenCalled();
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(status()).toEqual({ state: 'idle' });
  });

  it('records a birda failure, reports it and releases the lock', async () => {
    const run = analyze();
    (await started()).reject(new Error('birda exited with code 2'));

    await expect(run).rejects.toThrow('Analysis failed: birda exited with code 2');
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'failed');
    expect(status()).toEqual({ state: 'idle' });
    expect(lastStatusEvent()).toMatchObject({
      state: 'idle',
      finished: { status: 'failed', error: 'Analysis failed: birda exited with code 2' },
    });
  });

  it('records the run as failed when starting birda throws', async () => {
    vi.mocked(runAnalysis).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(analyze()).rejects.toThrow('boom');
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'failed');
    expect(status()).toEqual({ state: 'idle' });
  });

  it('keeps the birda error when recording the failure also fails', async () => {
    vi.mocked(finishRun).mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    const run = analyze();
    (await started()).reject(new Error('birda exited with code 2'));
    await expect(run).rejects.toThrow('Analysis failed: birda exited with code 2');
  });

  it('reports progress counted so far to a window that asks mid-run', async () => {
    const run = analyze();
    const handle = await started();
    const events: BirdaEventEnvelope[] = [
      { spec_version: '1', timestamp: '', event: 'pipeline_started', payload: { total_files: 3 } },
      {
        spec_version: '1',
        timestamp: '',
        event: 'file_completed',
        payload: { file: 'a.wav', status: 'processed', detections: 4, duration_ms: 1 },
      },
      {
        spec_version: '1',
        timestamp: '',
        event: 'file_completed',
        payload: { file: 'b.wav', status: 'failed', detections: 0, duration_ms: 1 },
      },
    ] as BirdaEventEnvelope[];
    for (const e of events) handle.emit(e);

    expect(status()).toEqual({
      state: 'running',
      sourcePath: sourceFile,
      settings: {
        model: 'birdnet',
        min_confidence: 0.1,
        latitude: undefined,
        longitude: undefined,
        location_name: undefined,
        month: undefined,
        day: undefined,
      },
      progress: {
        totalFiles: 3,
        filesProcessed: 2,
        filesFailed: 1,
        totalDetections: 4,
        completedFiles: [
          { file: 'a.wav', status: 'processed' },
          { file: 'b.wav', status: 'failed' },
        ],
      },
    });
    handle.resolve();
    await run;
  });

  it('does not replace earlier results when a directory run analysed no files', async () => {
    const run = analyze(tmp);
    const handle = await started();
    handle.emit({ spec_version: '1', timestamp: '', event: 'pipeline_started', payload: { total_files: 1 } });
    handle.emit({
      spec_version: '1',
      timestamp: '',
      event: 'file_completed',
      payload: { file: sourceFile, status: 'locked', detections: 0, duration_ms: 1 },
    });
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'completed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed', false);
  });
});

describe('birda:analyze same-named files in a directory run', () => {
  it('gives each file its own output even when a later file reuses the name', async () => {
    const dirA = path.join(tmp, 'a');
    const dirB = path.join(tmp, 'b');
    for (const d of [dirA, dirB]) fs.mkdirSync(d, { recursive: true });
    const fileA = path.join(dirA, 'rec.wav');
    const fileB = path.join(dirB, 'rec.wav');
    const reads: string[] = [];
    const readInto = (jsonPath: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file this test wrote
      reads.push(fs.readFileSync(jsonPath, 'utf-8'));
      return Promise.resolve({ detections: 0, sourceFile: 'x' });
    };
    vi.mocked(importDetectionsFromJson).mockImplementationOnce((_r, _l, _a, p) => readInto(p));
    vi.mocked(importDetectionsFromJson).mockImplementationOnce((_r, _l, _a, p) => readInto(p));

    const run = analyze(tmp);
    const handle = await started();
    const out = outputDirOf();
    const birdaOutput = path.join(out, 'rec.BirdNET.json');
    handle.emit(envelope('pipeline_started', { total_files: 2 }));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the handler's temp dir
    fs.writeFileSync(birdaOutput, 'first');
    handle.emit(envelope('file_completed', { file: fileA, status: 'processed', detections: 0 }));
    // birda's next same-named file writes over the same path once the first was claimed.
    await vi.waitFor(() => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the handler's temp dir
      expect(fs.existsSync(birdaOutput)).toBe(false);
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the handler's temp dir
    fs.writeFileSync(birdaOutput, 'second');
    handle.emit(envelope('file_completed', { file: fileB, status: 'processed', detections: 0 }));
    handle.resolve();

    await run;
    expect(reads).toEqual(['first', 'second']);
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  it('reports a skipped file of a directory run as failed', async () => {
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 2 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 0 }));
    handle.emit(envelope('file_completed', { file: 'b.wav', status: 'skipped' }));
    expect(status()).toMatchObject({ progress: { filesFailed: 1 } });
    expect(sentOn('birda:analysis-progress').at(-1)).toMatchObject({
      event: 'file_completed',
      payload: { file: 'b.wav', status: 'failed' },
    });
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'completed_with_errors' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed_with_errors', true);
  });
});

describe('birda:analyze outcomes', () => {
  it('records a single file birda could not analyse as failed without replacing earlier results', async () => {
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: sourceFile, status: 'failed' }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'failed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'failed', false);
  });

  it('does not replace earlier results when the single file was skipped', async () => {
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: sourceFile, status: 'skipped' }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'completed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed', false);
  });

  it('counts a failed file without detections as zero, not NaN', async () => {
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 2 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'failed' }));
    handle.emit(envelope('file_completed', { file: 'b.wav', status: 'processed', detections: 3 }));
    expect(status()).toMatchObject({ progress: { totalDetections: 3 } });
    handle.resolve();
    await run;
  });

  it('creates no location when stopped during setup', async () => {
    let releaseSettings!: (v: unknown) => void;
    h.settings.get.mockReturnValueOnce(new Promise((r) => (releaseSettings = r)));
    const run = analyze(sourceFile, { latitude: 60.1, longitude: 24.9 });
    await vi.waitFor(() => {
      expect(h.settings.get).toHaveBeenCalled();
    });
    cancel();
    releaseSettings({ default_execution_provider: 'cpu' });

    await expect(run).resolves.toMatchObject({ runId: null });
    expect(findLocationByCoords).not.toHaveBeenCalled();
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('reports an analysis that throws after a Stop as failed, like its run', async () => {
    const run = analyze();
    await started();
    cancel();
    vi.mocked(finishRun).mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    h.handles[0].reject(new AnalysisCancelledError());
    await expect(run).rejects.toThrow('database is locked');
    expect(finishRun).toHaveBeenLastCalledWith(expect.any(Number), 'failed');
    expect(lastStatusEvent()).toMatchObject({ state: 'idle', finished: { status: 'failed' } });
  });

  it('removes the temporary output of a cancelled directory run', async () => {
    const run = analyze(tmp);
    const handle = await started();
    const dir = outputDirOf();
    handle.reject(new AnalysisCancelledError());
    await run;
    expect(exists(dir)).toBe(false);
  });

  it('keeps birda output for debugging when birda failed, but not an empty directory', async () => {
    const first = analyze(tmp);
    const firstHandle = await started();
    const kept = outputDirOf(0);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp dir created by the handler
    fs.writeFileSync(path.join(kept, 'rec.BirdNET.json'), '{}');
    firstHandle.reject(new Error('birda exited with code 2'));
    await expect(first).rejects.toThrow();
    expect(exists(kept)).toBe(true);
    leftovers.push(kept);

    const second = analyze(tmp);
    const secondHandle = await started(2);
    const empty = outputDirOf(1);
    secondHandle.reject(new Error('Failed to start birda: spawn ENOENT'));
    await expect(second).rejects.toThrow();
    expect(exists(empty)).toBe(false);
  });
});

describe('stopAnalysisForQuit', () => {
  it('does not record a run again once it was recorded', async () => {
    let releaseRm!: () => void;
    const rm = vi.spyOn(fs.promises, 'rm').mockImplementationOnce(() => new Promise<void>((r) => (releaseRm = r)));
    const run = analyze(tmp);
    (await started()).resolve();
    await vi.waitFor(() => {
      expect(rm).toHaveBeenCalled();
    });
    // The run is recorded and its output is being removed; the lock is still held.
    stopAnalysisForQuit();
    releaseRm();
    await run;
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed', false);
  });

  it('writes nothing for events that arrive after the quit', async () => {
    const run = analyze();
    const handle = await started();
    stopAnalysisForQuit();
    handle.emit(envelope('detections', { file: sourceFile, detections: [{ scientific_name: 'Turdus merula' }] }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    handle.reject(new AnalysisCancelledError());
    await run;
    expect(getAudioMetadata).not.toHaveBeenCalled();
    expect(createAudioFile).not.toHaveBeenCalled();
  });

  it('records the run as cancelled once and leaves it to the quit', async () => {
    const run = analyze();
    const handle = await started();

    stopAnalysisForQuit();
    stopAnalysisForQuit();
    expect(handle.cancel).toHaveBeenCalledOnce();
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'cancelled');

    handle.reject(new AnalysisCancelledError());
    await expect(run).resolves.toMatchObject({ status: 'cancelled' });
    expect(finishRun).toHaveBeenCalledTimes(1);
  });
});

describe('birda:analyze, the rest of the outcome space', () => {
  it('replaces earlier results after a single file was analysed', async () => {
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: sourceFile, status: 'processed', detections: 0 }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'completed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed', true);
  });

  it('records a directory run with some failed files as completed with errors', async () => {
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 2 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    handle.emit(envelope('file_completed', { file: 'b.wav', status: 'failed' }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'completed_with_errors' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'completed_with_errors', true);
  });

  it('reports the run and whether its partial results were discarded when stopped', async () => {
    vi.mocked(finishRun).mockReturnValueOnce({ replaced: 0, discardedPartial: true });
    const run = analyze();
    (await started()).reject(new AnalysisCancelledError());
    const result = await run;
    expect(result).toEqual({ runId: expect.any(Number) as number, status: 'cancelled', discardedPartial: true });
  });

  it('counts a JSON import that failed as a failed file', async () => {
    vi.mocked(importDetectionsFromJson).mockRejectedValueOnce(new Error('bad JSON'));
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'failed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'failed', false);
  });

  it('counts a single-file insert that failed as a failed file', async () => {
    vi.mocked(insertDetections).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('detections', { file: sourceFile, detections: [{ scientific_name: 'Turdus merula' }] }));
    handle.emit(envelope('file_completed', { file: sourceFile, status: 'processed', detections: 1 }));
    handle.resolve();

    await expect(run).resolves.toMatchObject({ status: 'failed' });
    expect(finishRun).toHaveBeenCalledWith(expect.any(Number), 'failed', false);
  });

  it('records the run only after every pending import has finished', async () => {
    const importDone = deferred<{ detections: number; sourceFile: string }>();
    vi.mocked(importDetectionsFromJson).mockReturnValueOnce(importDone.promise);
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 2 }));
    handle.resolve();

    await vi.waitFor(() => {
      expect(importDetectionsFromJson).toHaveBeenCalled();
    });
    await new Promise((r) => setImmediate(r));
    expect(finishRun).not.toHaveBeenCalled();

    importDone.resolve({ detections: 2, sourceFile: 'a.wav' });
    await expect(run).resolves.toMatchObject({ status: 'completed' });
  });

  it('pushes the running and stopping states to every window as they happen', async () => {
    ipc.windows = [{ destroyed: false }, { destroyed: false }];
    const run = analyze();
    const handle = await started();
    expect(lastStatusEvent()).toMatchObject({ state: 'running', sourcePath: sourceFile });
    cancel();
    expect(lastStatusEvent()).toMatchObject({ state: 'stopping' });
    expect(ipc.sent.filter((m) => m.window === 1 && m.channel === 'birda:analysis-status-changed')).toHaveLength(
      statusEvents().length,
    );
    const count = statusEvents().length;
    cancel();
    expect(statusEvents()).toHaveLength(count);
    handle.reject(new AnalysisCancelledError());
    await run;
  });

  it('reports no analysis to stop when idle', () => {
    expect(cancel()).toBe(false);
    expect(isAnalysisActive()).toBe(false);
  });

  it('is active from the start of an analysis until it has finished', async () => {
    const run = analyze();
    const handle = await started();
    expect(isAnalysisActive()).toBe(true);
    handle.resolve();
    await run;
    expect(isAnalysisActive()).toBe(false);
  });

  it('takes birda’s final detection total for the progress snapshot', async () => {
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 2 }));
    handle.emit(envelope('pipeline_completed', { total_detections: 5 }));
    expect(status()).toMatchObject({ progress: { totalDetections: 5 } });
    handle.resolve();
    await run;
  });
});

describe('stopAnalysisForQuit, imports in flight', () => {
  it('writes nothing for a file whose import was in flight when the app quit', async () => {
    const metadata = deferred<Awaited<ReturnType<typeof getAudioMetadata>>>();
    vi.mocked(getAudioMetadata).mockReturnValueOnce(metadata.promise);
    const run = analyze();
    const handle = await started();
    handle.emit(envelope('detections', { file: sourceFile, detections: [{ scientific_name: 'Turdus merula' }] }));

    stopAnalysisForQuit();
    metadata.resolve({ durationSec: 1, sampleRate: 48000, channels: 1, audiomoth: null });
    handle.reject(new AnalysisCancelledError());
    await run;
    expect(createAudioFile).not.toHaveBeenCalled();
  });

  it('tells a directory import still reading its JSON to skip the insert after a quit', async () => {
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    await vi.waitFor(() => {
      expect(importDetectionsFromJson).toHaveBeenCalled();
    });
    const shouldSkipInsert = vi.mocked(importDetectionsFromJson).mock.calls[0][4];
    expect(shouldSkipInsert?.()).toBe(false);

    stopAnalysisForQuit();
    expect(shouldSkipInsert?.()).toBe(true);
    handle.reject(new AnalysisCancelledError());
    await run;
  });
});

describe('birda:analyze, what reaches birda and the catalog', () => {
  it('passes the request settings to the status and the date to birda', async () => {
    vi.mocked(createLocation).mockReturnValueOnce({
      id: 7,
      name: 'Park',
      latitude: 60.2,
      longitude: 24.9,
      description: null,
      created_at: '',
    });
    const run = analyze(sourceFile, {
      latitude: 60.2,
      longitude: 24.9,
      location_name: 'Park',
      month: 4,
      day: 1,
    });
    const handle = await started();
    expect(status()).toMatchObject({
      settings: {
        model: 'birdnet',
        min_confidence: 0.1,
        latitude: 60.2,
        longitude: 24.9,
        location_name: 'Park',
        month: 4,
        day: 1,
      },
    });
    expect(vi.mocked(runAnalysis).mock.calls[0][1]).toMatchObject({ month: 4, day: 1, dayOfYear: 92 });
    handle.resolve();
    await run;
  });

  it('reads the date from a YYYYMMDD_HHMMSS source name when none is given', async () => {
    const named = path.join(tmp, '20240501_053000.wav');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture under a fresh temp dir
    fs.writeFileSync(named, '');
    const run = analyze(named);
    const handle = await started();
    expect(vi.mocked(runAnalysis).mock.calls[0][1]).toMatchObject({ month: 5, day: 1, dayOfYear: 122 });
    handle.resolve();
    await run;
  });

  it('removes the audio file row of a file whose import failed', async () => {
    vi.mocked(importDetectionsFromJson).mockRejectedValueOnce(new Error('bad JSON'));
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('pipeline_started', { total_files: 1 }));
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    handle.resolve();
    await run;
    expect(deleteAudioFile).toHaveBeenCalledWith(1);
  });

  it('reports the running run as active until it is recorded', async () => {
    const run = analyze();
    const handle = await started();
    expect(activeRunId()).toEqual(expect.any(Number));
    handle.resolve();
    await run;
    expect(activeRunId()).toBeNull();
  });

  it('does not record a failed run again when the app quits while its output is checked', async () => {
    const readdir = vi.spyOn(fs.promises, 'readdir');
    const run = analyze(tmp);
    const handle = await started();
    let releaseReaddir!: () => void;
    readdir.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (releaseReaddir = r));
      return [];
    });
    handle.reject(new Error('birda exited with code 2'));
    await vi.waitFor(() => {
      expect(readdir).toHaveBeenCalled();
    });
    stopAnalysisForQuit();
    releaseReaddir();
    await expect(run).rejects.toThrow();
    expect(vi.mocked(finishRun).mock.calls.map((c) => c[1])).toEqual(['cancelled']);
  });

  it('skips a directory import that was reading its metadata when the app quit', async () => {
    const metadata = deferred<Awaited<ReturnType<typeof getAudioMetadata>>>();
    vi.mocked(getAudioMetadata).mockReturnValueOnce(metadata.promise);
    const run = analyze(tmp);
    const handle = await started();
    handle.emit(envelope('file_completed', { file: 'a.wav', status: 'processed', detections: 1 }));
    await vi.waitFor(() => {
      expect(getAudioMetadata).toHaveBeenCalled();
    });
    stopAnalysisForQuit();
    metadata.resolve({ durationSec: 1, sampleRate: 48000, channels: 1, audiomoth: null });
    handle.reject(new AnalysisCancelledError());
    await run;
    expect(createAudioFile).not.toHaveBeenCalled();
  });
});
