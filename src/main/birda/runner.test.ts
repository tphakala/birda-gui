/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCancelledError } from './analysis-session';
import { FakeChild, createFakeBirda, spawnedChild as waitForChild } from '../test-support/fake-child';
import { NO_USER_DATA } from '../test-support/ipc-harness';
import { BIRDA_CLI_VERSION, CUDA_LIBS_DIR_NAME, CUDA_VERSION_FILE } from '$shared/constants';

const dirs = vi.hoisted(() => ({ userData: '' }));
dirs.userData = NO_USER_DATA;
vi.mock('electron', () => ({ app: { getPath: () => dirs.userData } }));

const spawned = vi.hoisted(() => ({ children: [] as unknown[] }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(() => {
    const child = new FakeChild();
    spawned.children.push(child);
    return child;
  }),
}));

const { CANCEL_KILL_TIMEOUT_MS, birdaChildEnv, killAll, runAnalysis, setBirdaPath } = await import('./runner');

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

  it('passes --force for a single-file run but not for a directory run', async () => {
    const { spawn } = await import('child_process');
    const argsOfLastSpawn = () => vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];

    const single = runAnalysis('/rec.wav', options);
    (await spawnedChild()).exit(0);
    await single.promise;
    expect(argsOfLastSpawn()).toContain('--force');

    spawned.children = [];
    const directory = runAnalysis('/recordings', { ...options, outputDir: '/out' });
    (await spawnedChild()).exit(0);
    await directory.promise;
    expect(argsOfLastSpawn()).toContain('--output-dir');
    expect(argsOfLastSpawn()).not.toContain('--force');
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

  it('keeps the last 500 stderr lines and counts the ones dropped', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.stderr.write(Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n') + '\n');
    await new Promise((r) => setImmediate(r));
    child.exit(2);
    const message = ((await handle.promise.catch((e: unknown) => e)) as Error).message;
    expect(message).toContain('(100 earlier lines omitted)');
    expect(message).toContain('line 599');
    expect(message).toContain('line 100\n');
    expect(message).not.toContain('line 99\n');
    expect(message.split('\n')).toHaveLength(502);
  });

  it('shortens a very long stderr line', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const child = await spawnedChild();
    child.stderr.write('x'.repeat(5000) + '\n');
    await new Promise((r) => setImmediate(r));
    child.exit(2);
    const message = ((await handle.promise.catch((e: unknown) => e)) as Error).message;
    expect(message.length).toBeLessThan(1100);
    expect(message).not.toContain('earlier lines omitted');
  });

  it('starts birda with NO_COLOR set and the rest of the environment kept', async () => {
    const { spawn } = await import('child_process');
    const handle = runAnalysis('/rec.wav', options);
    (await spawnedChild()).exit(0);
    await handle.promise;
    const env = (vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env?: NodeJS.ProcessEnv }).env;
    expect(env?.NO_COLOR).toBe('1');
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it('removes colour codes from stderr in the error, the log and the stderr callback', async () => {
    const esc = String.fromCharCode(27);
    const handle = runAnalysis('/rec.wav', options);
    const logs: string[] = [];
    const lines: string[] = [];
    handle.on('log', (_level, message) => logs.push(message));
    handle.on('stderr', (line) => lines.push(line));
    const child = await spawnedChild();
    child.stderr.write(`${esc}[31merror:${esc}[0m model missing\n`);
    await new Promise((r) => setImmediate(r));
    child.exit(1);
    const message = ((await handle.promise.catch((e: unknown) => e)) as Error).message;
    expect(message).toContain('error: model missing');
    expect(message).not.toContain(esc);
    expect(lines).toEqual(['error: model missing']);
    expect(logs.join('\n')).not.toContain(esc);
  });

  it('logs an event by name only and skips progress events', async () => {
    const handle = runAnalysis('/rec.wav', options);
    const logs: string[] = [];
    handle.on('log', (_level, message) => logs.push(message));
    const child = await spawnedChild();
    const envelope = (event: string) =>
      JSON.stringify({ spec_version: '1', timestamp: 't', event, payload: { secret: 'payload-text' } }) + '\n';
    child.stdout.write(envelope('progress') + envelope('file_started'));
    await new Promise((r) => setImmediate(r));
    child.exit(0);
    await handle.promise;
    expect(logs).toContain('[event] file_started');
    expect(logs.join('\n')).not.toContain('payload-text');
    expect(logs.join('\n')).not.toContain('[event] progress');
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

describe('birdaChildEnv', () => {
  it('sets NO_COLOR and keeps the rest of the environment', () => {
    const env = birdaChildEnv();
    expect(env.NO_COLOR).toBe('1');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('lets extra values override a variable the environment already has', () => {
    const before = process.env.BIRDA_TEST_VAR;
    process.env.BIRDA_TEST_VAR = 'from-environment';
    try {
      expect(birdaChildEnv({ BIRDA_TEST_VAR: 'extra' }).BIRDA_TEST_VAR).toBe('extra');
    } finally {
      if (before === undefined) delete process.env.BIRDA_TEST_VAR;
      else process.env.BIRDA_TEST_VAR = before;
    }
  });
});

describe('runAnalysis CUDA libraries', () => {
  it('puts the downloaded CUDA libraries on the library path of the child', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-cuda-env-'));
    const libs = path.join(userData, CUDA_LIBS_DIR_NAME);
    fs.mkdirSync(libs);
    fs.writeFileSync(path.join(libs, CUDA_VERSION_FILE), BIRDA_CLI_VERSION);
    const previous = dirs.userData;
    dirs.userData = userData;
    try {
      const { spawn } = await import('child_process');
      const handle = runAnalysis('/rec.wav', options);
      (await spawnedChild()).exit(0);
      await handle.promise;
      const env = (vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv }).env;
      const searchPath = process.platform === 'win32' ? env.PATH : env.LD_LIBRARY_PATH;
      expect(searchPath?.startsWith(libs)).toBe(true);
      expect(env.NO_COLOR).toBe('1');
    } finally {
      dirs.userData = previous;
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
