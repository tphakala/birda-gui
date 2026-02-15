import { spawn, type ChildProcess, execFile } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import type { BirdaEventEnvelope } from './types';

const MAX_STDERR_LINES = 500;

// Global registry of active child processes for cleanup on shutdown
const activeProcesses = new Set<ChildProcess>();

/**
 * Terminates all active birda child processes.
 * Called on app shutdown to prevent zombie processes.
 */
export function killAll(): void {
  for (const proc of activeProcesses) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  }
  activeProcesses.clear();
}

/**
 * Registers a child process for cleanup on shutdown.
 * Call this for any long-running birda process (analysis, model install, etc.).
 */
export function registerProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
}

/**
 * Unregisters a child process from cleanup tracking.
 * Call this when the process exits normally or encounters an error.
 */
export function unregisterProcess(proc: ChildProcess): void {
  activeProcesses.delete(proc);
}

interface AnalysisOptions {
  model: string;
  minConfidence: number;
  executionProvider?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  month?: number | undefined;
  day?: number | undefined;
  dayOfYear?: number | undefined;
  quiet?: boolean | undefined;
  outputDir?: string | undefined;
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

function getExecutionProviderFlag(ep: string | undefined): string | null {
  if (!ep) return null;

  const flagMap: Record<string, string> = {
    auto: '--gpu',
    cpu: '--cpu',
    cuda: '--cuda',
    tensorrt: '--tensorrt',
    coreml: '--coreml',
    directml: '--directml',
    rocm: '--rocm',
    openvino: '--openvino',
    onednn: '--onednn',
    qnn: '--qnn',
    acl: '--acl',
    armnn: '--armnn',
    xnnpack: '--xnnpack',
  };

  return flagMap[ep.toLowerCase()] ?? null;
}

/**
 * Parses a semantic version string into major, minor, patch components.
 * Returns null if the version string is invalid.
 */
function parseVersion(versionString: string): { major: number; minor: number; patch: number } | null {
  const versionRegex = /^(\d+)\.(\d+)\.(\d+)/;
  const match = versionRegex.exec(versionString);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compares two semantic versions.
 * Returns:
 *   negative if v1 < v2
 *   0 if v1 === v2
 *   positive if v1 > v2
 */
function compareVersions(
  v1: { major: number; minor: number; patch: number },
  v2: { major: number; minor: number; patch: number },
): number {
  if (v1.major !== v2.major) return v1.major - v2.major;
  if (v1.minor !== v2.minor) return v1.minor - v2.minor;
  return v1.patch - v2.patch;
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

/**
 * Gets the birda CLI version by executing `birda -V`.
 * @param birdaPath - Path to the birda executable
 * @returns The version string (e.g., "1.6.0")
 * @throws Error if the version cannot be retrieved or parsed
 */
async function getBirdaVersion(birdaPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(birdaPath, ['-V'], { timeout: 2000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Failed to get birda version: ${err.message}`));
        return;
      }

      // birda -V outputs: "birda 1.6.0", "Birda CLI v1.6.0" or similar
      // Case insensitive, allows optional 'v' prefix, flexible spacing
      const output = (stdout || stderr).trim();
      const versionRegex = /birda.*?\s+v?(\d+\.\d+\.\d+)/i;
      const match = versionRegex.exec(output);

      if (!match) {
        reject(new Error(`Could not parse birda version from output: ${output}`));
        return;
      }

      resolve(match[1]);
    });
  });
}

/**
 * Validates that the birda CLI version meets the minimum required version.
 * @param birdaPath - Path to the birda executable
 * @param minVersion - Minimum required version (e.g., "1.6.0")
 * @returns Object with version info and validation status
 */
export async function validateBirdaVersion(
  birdaPath: string,
  minVersion: string,
): Promise<{ version: string; meetsMinimum: boolean; minVersion: string }> {
  const version = await getBirdaVersion(birdaPath);
  const parsedVersion = parseVersion(version);
  const parsedMinVersion = parseVersion(minVersion);

  if (!parsedVersion || !parsedMinVersion) {
    throw new Error(`Invalid version format: ${version} or ${minVersion}`);
  }

  const meetsMinimum = compareVersions(parsedVersion, parsedMinVersion) >= 0;

  return {
    version,
    meetsMinimum,
    minVersion,
  };
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

      const args: string[] = [];

      // Conditional output mode
      if (options.outputDir) {
        args.push('--output-dir', options.outputDir);
        args.push('--output-mode', 'ndjson');
        args.push('--format', 'json'); // Write JSON files to disk (not CSV)
      } else {
        args.push('--stdout');
      }

      // Existing args
      args.push('--force', '--model', options.model, '-c', String(options.minConfidence));

      // Execution provider
      const epFlag = getExecutionProviderFlag(options.executionProvider);
      if (epFlag) {
        args.push(epFlag);
      }

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
      registerProcess(child);

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

      child.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (stderrLines.length < MAX_STDERR_LINES) {
          stderrLines.push(text);
        }
        emitLog('warn', `[stderr] ${text}`);
      });

      child.on('close', (code) => {
        if (child) {
          unregisterProcess(child);
        }
        emitLog('info', `Process exited with code ${code}`);
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`birda exited with code ${code}\n${stderrLines.join('')}`));
        }
      });

      child.on('error', (err) => {
        if (child) {
          unregisterProcess(child);
        }
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
        unregisterProcess(child);
      }
    },
    promise,
    stderrLog: () => stderrLines.join(''),
  };
}
