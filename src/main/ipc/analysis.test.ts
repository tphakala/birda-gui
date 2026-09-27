import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCancelledError } from '../birda/analysis-session';
import type { AnalysisResult, AnalysisStatus, BirdaEventEnvelope } from '$shared/types';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

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
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    sent: [] as { channel: string; payload: unknown }[],
    handles: [] as ReturnType<typeof fakeHandle>[],
    fakeHandle,
    settings: { get: vi.fn() },
    nextRunId: 1,
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) },
      },
    ],
  },
  dialog: {},
  app: { getPath: () => path.join(os.tmpdir(), 'birda-gui-test-no-such-dir') },
}));

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
vi.mock('../db/audio-files', () => ({ createAudioFile: vi.fn(() => 1) }));
vi.mock('../settings/store', () => ({ settingsStore: h.settings }));

const { registerAnalysisHandlers, stopAnalysisForQuit } = await import('./analysis');
const { runAnalysis } = await import('../birda/runner');
const { createRun, finishRun } = await import('../db/runs');
const { createLocation, findLocationByCoords } = await import('../db/locations');
const { createAudioFile } = await import('../db/audio-files');
registerAnalysisHandlers();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-analysis-test-'));
const sourceFile = path.join(tmp, 'rec.wav');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture under a fresh temp dir
fs.writeFileSync(sourceFile, '');

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

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

function lastStatusEvent(): AnalysisStatus {
  const events = h.sent.filter((s) => s.channel === 'birda:analysis-status-changed');
  return events[events.length - 1].payload as AnalysisStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.handles = [];
  h.sent = [];
  h.settings.get.mockResolvedValue({ default_execution_provider: 'cpu' });
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
    fs.rmSync(kept, { recursive: true, force: true });

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
    rm.mockRestore();
  });

  it('writes nothing for events that arrive after the quit', async () => {
    const run = analyze();
    const handle = await started();
    stopAnalysisForQuit();
    handle.emit(envelope('detections', { file: sourceFile, detections: [{ scientific_name: 'Turdus merula' }] }));
    handle.reject(new AnalysisCancelledError());
    await run;
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
