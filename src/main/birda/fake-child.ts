import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

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

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, signal);
  }
}
