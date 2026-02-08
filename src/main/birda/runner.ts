import { spawn, type ChildProcess, execFile } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import type { BirdaEventEnvelope } from './types';

interface AnalysisOptions {
  model: string;
  minConfidence: number;
  latitude?: number | undefined;
  longitude?: number | undefined;
  month?: number | undefined;
  day?: number | undefined;
  dayOfYear?: number | undefined;
  quiet?: boolean | undefined;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface AnalysisHandle {
  on(event: 'data', callback: (envelope: BirdaEventEnvelope) => void): void;
  on(event: 'log', callback: (level: LogLevel, message: string) => void): void;
  cancel: () => void;
  promise: Promise<void>;
  stderrLog: () => string;
}

let configuredBirdaPath: string | null = null;

export function setBirdaPath(p: string): void {
  configuredBirdaPath = p;
}

export async function findBirda(): Promise<string> {
  if (configuredBirdaPath) {
    const basename = path.basename(configuredBirdaPath).toLowerCase();
    if (basename !== 'birda' && basename !== 'birda.exe') {
      throw new Error(`Configured path does not point to a birda binary: ${configuredBirdaPath}`);
    }
    try {
      await fs.promises.access(configuredBirdaPath, fs.constants.X_OK);
      return configuredBirdaPath;
    } catch {
      throw new Error(`Configured birda path not found or not executable: ${configuredBirdaPath}`);
    }
  }

  const binaryName = process.platform === 'win32' ? 'birda.exe' : 'birda';
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

  return new Promise((resolve, reject) => {
    execFile(whichCmd, [binaryName], (err, stdout) => {
      if (err || !stdout.trim()) {
        reject(
          new Error(
            `birda CLI not found in PATH. Install birda or set the path in Settings.\n` +
              `Download: https://github.com/tphakala/birda`,
          ),
        );
        return;
      }
      resolve(stdout.trim().split('\n')[0]);
    });
  });
}

export function runAnalysis(sourcePath: string, options: AnalysisOptions): AnalysisHandle {
  let child: ChildProcess | null = null;
  let dataCallback: ((envelope: BirdaEventEnvelope) => void) | null = null;
  let logCallback: ((level: LogLevel, message: string) => void) | null = null;
  const stderrLines: string[] = [];

  function emitLog(level: LogLevel, message: string) {
    logCallback?.(level, message);
  }

  const promise = new Promise<void>((resolve, reject) => {
    void (async () => {
      let birdaPath: string;
      try {
        birdaPath = await findBirda();
      } catch (e) {
        emitLog('error', `Failed to find birda: ${(e as Error).message}`);
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      const args = ['--stdout', '--force', '--model', options.model, '-c', String(options.minConfidence)];
      if (options.latitude !== undefined && options.longitude !== undefined) {
        args.push('--lat', String(options.latitude), '--lon', String(options.longitude));
      }
      if (options.month !== undefined) {
        args.push('--month', String(options.month));
      }
      if (options.day !== undefined) {
        args.push('--day', String(options.day));
      }
      if (options.dayOfYear !== undefined) {
        args.push('--day-of-year', String(options.dayOfYear));
      }
      if (options.quiet !== false) {
        args.push('-q');
      }
      args.push(sourcePath);

      emitLog('info', `Spawning: ${birdaPath} ${args.join(' ')}`);

      child = spawn(birdaPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const rl = createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const envelope = JSON.parse(line) as BirdaEventEnvelope;
          emitLog('debug', `[event] ${envelope.event}: ${JSON.stringify(envelope.payload)}`);
          dataCallback?.(envelope);
        } catch {
          const msg = `[non-json stdout]: ${line}`;
          stderrLines.push(msg);
          emitLog('warn', msg);
        }
      });

      const MAX_STDERR_LINES = 500;
      child.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (stderrLines.length < MAX_STDERR_LINES) {
          stderrLines.push(text);
        }
        emitLog('warn', `[stderr] ${text}`);
      });

      child.on('close', (code) => {
        emitLog('info', `Process exited with code ${code}`);
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`birda exited with code ${code}\n${stderrLines.join('')}`));
        }
      });

      child.on('error', (err) => {
        emitLog('error', `Failed to start birda: ${err.message}`);
        reject(new Error(`Failed to start birda: ${err.message}`));
      });
    })();
  });

  return {
    on(event: 'data' | 'log', callback: (...args: never[]) => void) {
      if (event === 'data') {
        dataCallback = callback as (envelope: BirdaEventEnvelope) => void;
      } else {
        logCallback = callback as (level: LogLevel, message: string) => void;
      }
    },
    cancel: () => {
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    },
    promise,
    stderrLog: () => stderrLines.join(''),
  };
}
