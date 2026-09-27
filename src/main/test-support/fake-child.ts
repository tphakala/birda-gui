import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, vi } from 'vitest';

/**
 * Test stand-in for a spawned birda. It keeps killed, exitCode and signalCode
 * the way Node's ChildProcess does: kill() marks killed but the process only
 * ends when exit() is called, and kill() after exit sends nothing. Every kill()
 * call is recorded in killCalls, including ones after exit, so a test can
 * check that code did not try to signal an exited process.
 */
export class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  /** Signals delivered while the process was running. */
  signals: string[] = [];
  /** Every kill() call. */
  killCalls: string[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killCalls.push(signal);
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signals.push(signal);
    this.killed = true;
    return true;
  }

  /** A spawn that failed: no pid, then 'error' and 'close' with code -2, as Node reports ENOENT. */
  failToSpawn(message = 'spawn birda ENOENT'): void {
    this.pid = undefined;
    this.exitCode = -2;
    this.emit('error', new Error(message));
    this.stdout.end();
    this.stderr.end();
    this.emit('close', -2, null);
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

/** A temporary executable named birda, for setBirdaPath; findBirda only checks that it exists and can run. */
export function createFakeBirda(): { path: string; remove: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-fake-bin-'));
  const birdaPath = path.join(dir, 'birda');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture under a fresh temp dir
  fs.writeFileSync(birdaPath, '');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture under a fresh temp dir
  fs.chmodSync(birdaPath, 0o755);
  return {
    path: birdaPath,
    remove: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Waits until spawn has produced the given number of children and returns the last one. */
export async function spawnedChild(children: unknown[], count = 1): Promise<FakeChild> {
  await vi.waitFor(() => {
    expect(children).toHaveLength(count);
  });
  return children[count - 1] as FakeChild;
}
