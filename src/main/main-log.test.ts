/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dirs = vi.hoisted(() => ({ userData: '', on: vi.fn(), off: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => dirs.userData, getVersion: () => '0.0.0', on: dirs.on, off: dirs.off },
}));

const { formatLogLine, logFilePath, startMainLog, stopMainLog } = await import('./main-log');

beforeEach(() => {
  dirs.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-log-'));
  // Keep the test output quiet; the wrapper calls whatever console.* is when it starts.
  for (const level of ['log', 'info', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => undefined);
});

afterEach(() => {
  stopMainLog();
  vi.restoreAllMocks();
  fs.rmSync(dirs.userData, { recursive: true, force: true });
});

describe('formatLogLine', () => {
  it('starts with the time and level and formats the arguments like console does', () => {
    const line = formatLogLine('warn', ['disk %d%% full', 93, { a: 1 }], new Date('2026-05-01T05:30:00.000Z'));
    expect(line).toBe('2026-05-01T05:30:00.000Z [warn] disk 93% full { a: 1 }\n');
  });
});

describe('startMainLog', () => {
  it('writes console output with time and level to logs/main.log', () => {
    startMainLog();
    console.error('[catalog] failed', new Error('boom'));
    console.log('plain');
    const text = fs.readFileSync(logFilePath(), 'utf-8');
    expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[info\] \[main\] Birda GUI 0\.0\.0 started/);
    expect(text).toMatch(/\[error\] \[catalog\] failed Error: boom/);
    expect(text).toMatch(/\[log\] plain\n$/);
  });

  it('still calls the original console method', () => {
    const spy = vi.mocked(console.warn);
    startMainLog();
    console.warn('hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('moves a log larger than 5 MB to main.old.log and starts a new one', () => {
    const file = logFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1, 'a'));
    startMainLog();
    console.log('fresh');
    expect(fs.statSync(path.join(path.dirname(file), 'main.old.log')).size).toBe(5 * 1024 * 1024 + 1);
    expect(fs.statSync(file).size).toBeLessThan(1000);
  });

  it('keeps a log under 5 MB and appends to it', () => {
    const file = logFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'old line\n');
    startMainLog();
    expect(fs.readFileSync(file, 'utf-8')).toMatch(/^old line\n/);
    expect(fs.existsSync(path.join(path.dirname(file), 'main.old.log'))).toBe(false);
  });

  it('stops after 10 MB with a single limit line', () => {
    startMainLog();
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 12; i++) console.log(chunk);
    console.log('after the cap');
    const text = fs.readFileSync(logFilePath(), 'utf-8');
    expect(text.match(/log size limit reached/g)).toHaveLength(1);
    expect(text).not.toContain('after the cap');
    expect(Buffer.byteLength(text)).toBeLessThan(10.5 * 1024 * 1024);
  });

  it('restores the console and writes nothing after stopMainLog', () => {
    const before = console.log;
    startMainLog();
    expect(console.log).not.toBe(before);
    stopMainLog();
    expect(console.log).toBe(before);
    const size = fs.statSync(logFilePath()).size;
    console.log('unlogged');
    expect(fs.statSync(logFilePath()).size).toBe(size);
  });

  it('logs an unhandled rejection', () => {
    startMainLog();
    (process as NodeJS.EventEmitter).emit('unhandledRejection', new Error('late failure'), Promise.resolve());
    expect(fs.readFileSync(logFilePath(), 'utf-8')).toContain(
      '[error] [main] Unhandled rejection: Error: late failure',
    );
  });

  /** The handler startMainLog registered with app.on for an event. */
  function appHandler(event: string): (...args: unknown[]) => void {
    const call = dirs.on.mock.calls.findLast((c: unknown[]) => c[0] === event);
    if (!call) throw new Error(`no ${event} handler`);
    return call[1] as (...args: unknown[]) => void;
  }

  it('logs a renderer process that went away', () => {
    startMainLog();
    appHandler('render-process-gone')({}, {}, { reason: 'crashed', exitCode: 11 });
    expect(fs.readFileSync(logFilePath(), 'utf-8')).toContain(
      '[error] [main] Renderer process gone: reason=crashed exitCode=11',
    );
  });

  it('logs a child process that went away', () => {
    startMainLog();
    appHandler('child-process-gone')({}, { type: 'GPU', reason: 'killed', exitCode: 9 });
    expect(fs.readFileSync(logFilePath(), 'utf-8')).toContain(
      '[error] [main] GPU process gone: reason=killed exitCode=9',
    );
  });

  it('logs an uncaught exception from the monitor', () => {
    startMainLog();
    (process as NodeJS.EventEmitter).emit('uncaughtExceptionMonitor', new Error('fatal'), 'uncaughtException');
    expect(fs.readFileSync(logFilePath(), 'utf-8')).toContain(
      '[error] [main] Uncaught exception (uncaughtException): Error: fatal',
    );
  });

  it('removes its process and app listeners on stopMainLog', () => {
    const monitors = process.listenerCount('uncaughtExceptionMonitor');
    const rejections = process.listenerCount('unhandledRejection');
    startMainLog();
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(monitors + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(rejections + 1);
    const rendererHandler = appHandler('render-process-gone');
    const childHandler = appHandler('child-process-gone');
    stopMainLog();
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(monitors);
    expect(process.listenerCount('unhandledRejection')).toBe(rejections);
    expect(dirs.off).toHaveBeenCalledWith('render-process-gone', rendererHandler);
    expect(dirs.off).toHaveBeenCalledWith('child-process-gone', childHandler);
  });
});
