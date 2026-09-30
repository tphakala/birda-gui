import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { format } from 'util';

/** main.log is moved to main.old.log at start when it is larger than this. */
const ROTATE_BYTES = 5 * 1024 * 1024;
/** One session stops writing after this many bytes, so a runaway loop cannot fill the disk. */
const SESSION_CAP_BYTES = 10 * 1024 * 1024;

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

export function logFilePath(): string {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
}

export function formatLogLine(level: string, args: unknown[], now: Date = new Date()): string {
  return `${now.toISOString()} [${level}] ${format(...args)}\n`;
}

interface ActiveLog {
  fd: number;
  written: number;
  capped: boolean;
  originals: Record<Level, (...args: unknown[]) => void>;
  detach: (() => void)[];
}

let active: ActiveLog | null = null;

const consoleMethods = console as unknown as Record<Level, (...args: unknown[]) => void>;

function write(log: ActiveLog, level: string, args: unknown[]): void {
  if (log.capped) return;
  try {
    let line = formatLogLine(level, args);
    if (log.written + Buffer.byteLength(line) > SESSION_CAP_BYTES) {
      log.capped = true;
      line = formatLogLine('warn', ['log size limit reached, no more lines are written this session']);
    }
    log.written += fs.writeSync(log.fd, line);
  } catch {
    // Logging must never break the app; a failed write just loses the line.
  }
}

/**
 * Copies console output, uncaught exceptions, unhandled rejections and process crashes of the main
 * process to {userData}/logs/main.log. A failure to set the file up leaves the
 * console as it was.
 */
export function startMainLog(): void {
  if (active) return;
  try {
    const file = logFilePath();
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (fs.statSync(file).size > ROTATE_BYTES) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        fs.renameSync(file, path.join(path.dirname(file), 'main.old.log'));
      }
    } catch {
      // No log yet.
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fd = fs.openSync(file, 'a');
    const log: ActiveLog = {
      fd,
      written: 0,
      capped: false,
      originals: {} as ActiveLog['originals'],
      detach: [],
    };
    active = log;

    for (const level of LEVELS) {
      /* eslint-disable security/detect-object-injection -- level comes from the fixed LEVELS list */
      const original = consoleMethods[level];
      log.originals[level] = original;
      consoleMethods[level] = (...args: unknown[]) => {
        original.apply(console, args);
        write(log, level, args);
      };
      /* eslint-enable security/detect-object-injection */
    }

    // Electron's main process warns about an unhandled rejection instead of throwing, and the monitor below is
    // never called for it, so the rejection is written down here. Listening does not change what happens next.
    const onRejection = (reason: unknown) => {
      write(log, 'error', ['[main] Unhandled rejection:', reason]);
    };
    process.on('unhandledRejection', onRejection);
    log.detach.push(() => process.off('unhandledRejection', onRejection));

    // The monitor does not change how Node handles the exception, so it is only written down.
    const onUncaught = (err: Error, origin: string) => {
      write(log, 'error', [`[main] Uncaught exception (${origin}):`, err]);
    };
    process.on('uncaughtExceptionMonitor', onUncaught);
    log.detach.push(() => process.off('uncaughtExceptionMonitor', onUncaught));

    const onRendererGone = (_event: unknown, _contents: unknown, details: { reason: string; exitCode: number }) => {
      console.error(`[main] Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    };
    app.on('render-process-gone', onRendererGone);
    log.detach.push(() => app.off('render-process-gone', onRendererGone));

    const onChildGone = (_event: unknown, details: { type: string; reason: string; exitCode: number }) => {
      console.error(`[main] ${details.type} process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    };
    app.on('child-process-gone', onChildGone);
    log.detach.push(() => app.off('child-process-gone', onChildGone));

    console.info(`[main] Birda GUI ${app.getVersion()} started (${process.platform} ${process.arch})`);
  } catch (err) {
    stopMainLog();
    console.error('[main] Could not start the log file:', err);
  }
}

/** Restores the console, removes the listeners and closes the file. */
export function stopMainLog(): void {
  const log = active;
  if (!log) return;
  active = null;
  for (const level of LEVELS) {
    // eslint-disable-next-line security/detect-object-injection
    consoleMethods[level] = log.originals[level];
  }
  for (const detach of log.detach) detach();
  try {
    fs.closeSync(log.fd);
  } catch {
    // Already closed.
  }
}
