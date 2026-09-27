import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCancelledError } from './analysis-session';
import { FakeChild, createFakeBirda, spawnedChild as waitForChild } from '../test-support/fake-child';
import { NO_USER_DATA } from '../test-support/ipc-harness';

vi.mock('electron', () => ({ app: { getPath: () => NO_USER_DATA } }));

const spawned = vi.hoisted(() => ({ children: [] as unknown[] }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(() => {
    const child = new FakeChild();
    spawned.children.push(child);
    return child;
  }),
}));

const { CANCEL_KILL_TIMEOUT_MS, killAll, runAnalysis, setBirdaPath } = await import('./runner');

const fakeBirda = createFakeBirda();
const options = { model: 'birdnet', minConfidence: 0.1 };
const spawnedChild = () => waitForChild(spawned.children);

beforeEach(() => {
  spawned.children = [];
  setBirdaPath(fakeBirda.path);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fakeBirda.remove();
});

describe('runAnalysis', () => {
  it('never spawns birda when cancelled before spawn', async () => {
    const handle = runAnalysis('/rec.wav', options);
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(spawned.children).toHaveLength(0);
  });

  it('rejects as cancelled when birda cannot be found after a cancel', async () => {
    setBirdaPath(path.join(path.dirname(fakeBirda.path), 'missing', 'birda'));
    const handle = runAnalysis('/rec.wav', options);
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it('resolves when birda exits with code 0', async () => {
    const handle = runAnalysis('/rec.wav', options);
    (await spawnedChild()).exit(0);
    await expect(handle.promise).resolves.toBeUndefined();
  });

  it('carries birda’s stderr in the error of a failed run', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.stderr.write('model file not found\n');
    await new Promise((r) => setImmediate(r));
    child.exit(2);
    await expect(handle.promise).rejects.toThrow('birda exited with code 2\nmodel file not found');
  });

  it('rejects a signal exit without a cancel as a failure', async () => {
    const handle = runAnalysis('/rec.wav', options);
    (await spawnedChild()).exit(null, 'SIGKILL');
    const err = await handle.promise.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AnalysisCancelledError);
    expect((err as Error).message).toMatch(/^birda was terminated by SIGKILL/);
  });

  it('rejects as cancelled and sends no SIGKILL once birda exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    handle.cancel();
    expect(child.signals).toEqual(['SIGTERM']);

    child.exit(null, 'SIGTERM');
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS * 2);
    expect(child.killCalls).toEqual(['SIGTERM']);
  });

  it('sends SIGKILL when birda ignores SIGTERM', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    handle.cancel();

    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS - 1);
    expect(child.signals).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(1);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

    child.exit(null, 'SIGKILL');
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it('sends one SIGTERM and arms one timer for repeated cancels', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    handle.cancel();
    handle.cancel();
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    child.exit(null, 'SIGKILL');
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it('does nothing when cancelled after birda exited', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.exit(0);
    await handle.promise;
    handle.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS);
    expect(child.killCalls).toEqual([]);
  });

  it('waits for close when a started process reports an error', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    let settled = false;
    void handle.promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    child.emit('error', new Error('kill EPERM'));
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    child.exit(0);
    await expect(handle.promise).resolves.toBeUndefined();
  });

  it('rejects when spawn throws', async () => {
    const { spawn } = await import('child_process');
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new TypeError('argument must not contain null bytes');
    });
    const handle = runAnalysis('/rec.wav', options);
    await expect(handle.promise).rejects.toThrow('Failed to start birda: argument must not contain null bytes');
  });

  it('rejects when birda fails to start, and releases it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    handle.cancel();
    child.failToSpawn();
    await expect(handle.promise).rejects.toThrow('Failed to start birda: spawn birda ENOENT');
    expect(vi.getTimerCount()).toBe(0);
    killAll();
    expect(child.killCalls).toEqual(['SIGTERM']);
  });
});

describe('killAll', () => {
  it('sends SIGKILL to a stopping birda and SIGTERM to a running one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stopping = runAnalysis('/a.wav', options);
    const stoppingChild = await spawnedChild();
    stopping.cancel();

    spawned.children = [];
    const running = runAnalysis('/b.wav', options);
    const runningChild = await spawnedChild();

    killAll();
    expect(stoppingChild.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(runningChild.signals).toEqual(['SIGTERM']);

    stoppingChild.exit(null, 'SIGKILL');
    runningChild.exit(null, 'SIGTERM');
    await expect(stopping.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    await expect(running.promise).rejects.toThrow(/terminated by SIGTERM/);
  });

  it('skips a birda that already exited', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.exitCode = 0;
    killAll();
    expect(child.killCalls).toEqual([]);
    child.exit(0);
    await handle.promise;
  });
});
