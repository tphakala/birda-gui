import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCancelledError } from './analysis-session';

vi.mock('electron', () => ({ app: { getPath: () => path.join(os.tmpdir(), 'birda-gui-test-no-such-dir') } }));

// A stand-in for a spawned birda that keeps killed, exitCode and signalCode the
// way Node's ChildProcess does: kill() marks killed but the process only ends
// when exit() is called.
class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signals.push(signal);
    this.killed = true;
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, signal);
  }
}

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

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-runner-test-'));
const birdaPath = path.join(binDir, 'birda');
fs.writeFileSync(birdaPath, '');
fs.chmodSync(birdaPath, 0o755);

const options = { model: 'birdnet', minConfidence: 0.1 };

async function spawnedChild(): Promise<FakeChild> {
  await vi.waitFor(() => {
    expect(spawned.children).toHaveLength(1);
  });
  return spawned.children[0] as FakeChild;
}

beforeEach(() => {
  spawned.children = [];
  setBirdaPath(birdaPath);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe('runAnalysis', () => {
  it('never spawns birda when cancelled before spawn', async () => {
    const handle = runAnalysis('/rec.wav', options);
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(spawned.children).toHaveLength(0);
  });

  it('rejects as cancelled when birda cannot be found after a cancel', async () => {
    setBirdaPath(path.join(binDir, 'missing', 'birda'));
    const handle = runAnalysis('/rec.wav', options);
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it('resolves when birda exits with code 0', async () => {
    const handle = runAnalysis('/rec.wav', options);
    (await spawnedChild()).exit(0);
    await expect(handle.promise).resolves.toBeUndefined();
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
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS * 2);
    expect(child.signals).toEqual(['SIGTERM']);
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
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS);
    expect(child.signals).toEqual([]);
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

  it('rejects when birda fails to start', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.pid = undefined;
    child.emit('error', new Error('spawn ENOENT'));
    await expect(handle.promise).rejects.toThrow('Failed to start birda: spawn ENOENT');
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
    expect(child.signals).toEqual([]);
    child.exit(0);
    await handle.promise;
  });
});
