import { spawn } from 'child_process';
import { execBirda } from './exec';
import { findBirda, superviseChild, type SupervisedChild } from './runner';
import { classifyExit } from './process-exit';
import { parseProgressLine } from './progress';
import type {
  InstalledModel,
  AvailableModel,
  ModelRemovedResult,
  ModelInstalledResult,
  ModelManifest,
  ModelInstallProgress,
  ModelInstallRequest,
} from '$shared/types';

interface BirdaJsonEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

async function runBirdaJson(args: string[]): Promise<BirdaJsonEnvelope> {
  const stdout = await execBirda(args, { errorPrefix: 'birda command failed: ' });
  try {
    return JSON.parse(stdout) as BirdaJsonEnvelope;
  } catch {
    throw new Error(`Failed to parse birda output as JSON: ${stdout.slice(0, 200)}`);
  }
}

export async function listModels(): Promise<InstalledModel[]> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'list']);
  const payload = envelope.payload as { models?: InstalledModel[] };
  return payload.models ?? [];
}

export async function listAvailable(): Promise<AvailableModel[]> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'list-available']);
  const payload = envelope.payload as { models?: AvailableModel[] };
  return payload.models ?? [];
}

// Set by cancelInstall for the install holding the slot, and read after the
// await in installModel and in the close handler. It is read through
// cancelRequested(): TypeScript narrows a checked property across an await
// just as it does a let.
const cancelState = { requested: false };

// The install holding the single install slot, from the start of installModel
// until it settles; the slot is taken before the first await, so a concurrent
// call during findBirda() is refused.
let currentRequest: ModelInstallRequest | null = null;
// Its process, once spawned.
let installProcess: SupervisedChild | null = null;

/**
 * Stops the install holding the slot, if any, including one still locating
 * birda: SIGTERM, then SIGKILL if it does not exit. The install keeps its slot
 * until it settles. Returns true if an install holds the slot.
 */
export function cancelInstall(): boolean {
  if (!currentRequest) return false;
  cancelState.requested = true;
  installProcess?.stop();
  return true;
}

// Read through a function so TS does not narrow the post-await check to a literal.
const cancelRequested = (): boolean => cancelState.requested;

/** Rejects an install requested while another one holds the single install slot. */
export class ModelInstallBusyError extends Error {
  constructor() {
    super('Another model install is already running');
    this.name = 'ModelInstallBusyError';
  }
}

/** Rejects an install that ended because it was cancelled. */
export class ModelInstallCancelledError extends Error {
  constructor() {
    super('Model install cancelled');
    this.name = 'ModelInstallCancelledError';
  }
}

/** The install in flight, for a window that did not start it. */
export function getInstallStatus(): ModelInstallRequest | null {
  return currentRequest;
}

export async function installModel(
  opts: ModelInstallRequest,
  onProgress?: (progress: ModelInstallProgress) => void,
): Promise<ModelInstalledResult> {
  // The slot and cancel state are released in the finally when this operation
  // settles, so cancellation before close stays cancellation.
  if (currentRequest) {
    throw new ModelInstallBusyError();
  }
  currentRequest = { id: opts.id, region: opts.region, variant: opts.variant };
  cancelState.requested = false;
  try {
    let birdaPath: string;
    try {
      birdaPath = await findBirda();
    } catch (err) {
      // A Stop while birda was being located is a cancel, even if locating it failed.
      if (cancelRequested()) throw new ModelInstallCancelledError();
      throw err;
    }
    // A cancel that arrived while findBirda() was resolving must still stop the spawn.
    if (cancelRequested()) {
      throw new ModelInstallCancelledError();
    }
    const args = ['--output-mode', 'json', 'models', 'install', opts.id];
    if (opts.region) args.push('--region', opts.region);
    if (opts.variant) args.push('--variant', opts.variant);
    return await new Promise<ModelInstalledResult>((resolve, reject) => {
      // JSON mode auto-accepts license and defaults "set as default?" to no.
      // No stdin interaction needed: the GUI shows its own license dialog
      // and manages defaults separately via birda:models-set-default.
      const proc = spawn(birdaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const tracked = superviseChild(proc);
      installProcess = tracked;

      let stdout = '';
      let stderrRemainder = '';

      // stdout = final JSON envelope (not progress)
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // stderr = indicatif progress bars ("<bar> 42% (58.0 MB/138.0 MB)")
      const emit = (line: string) => {
        if (onProgress) onProgress(parseProgressLine(line));
      };

      proc.stderr.on('data', (data: Buffer) => {
        if (!onProgress) return;
        const combined = stderrRemainder + data.toString();
        const parts = combined.split('\n');
        stderrRemainder = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) emit(trimmed);
        }
      });

      proc.stdin.end();

      proc.on('close', (code) => {
        tracked.release();
        if (stderrRemainder.trim()) {
          emit(stderrRemainder.trim());
        }
        const outcome = classifyExit(code, cancelRequested());
        // A non-zero exit right after a cancel is the kill, not a real failure;
        // report it as a cancellation so the renderer labels it correctly.
        if (outcome === 'cancelled') {
          reject(new ModelInstallCancelledError());
          return;
        }
        if (outcome === 'failed') {
          reject(new Error(`Model install failed: ${stdout}`));
          return;
        }
        try {
          const envelope = JSON.parse(stdout) as BirdaJsonEnvelope;
          const payload = envelope.payload as unknown as ModelInstalledResult;
          resolve(payload);
        } catch {
          reject(new Error(`Failed to parse install result: ${stdout.slice(0, 200)}`));
        }
      });

      proc.on('error', (err) => {
        // A process that did start still emits close, which settles the install.
        if (proc.pid !== undefined) {
          console.warn(`Model install process error: ${err.message}`);
          return;
        }
        tracked.release();
        reject(new Error(`Model install failed: ${err.message}`));
      });
    });
  } finally {
    installProcess = null;
    currentRequest = null;
    cancelState.requested = false;
  }
}

export async function removeModel(name: string): Promise<ModelRemovedResult> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'remove', name, '--purge']);
  return envelope.payload as unknown as ModelRemovedResult;
}

export async function modelInfo(name: string): Promise<unknown> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'info', name]);
  return envelope.payload;
}

export async function getManifest(id: string): Promise<ModelManifest> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'manifest', id]);
  const payload = envelope.payload as { manifest?: ModelManifest } | null | undefined;
  const manifest = payload?.manifest;
  // Guard against an older/other birda whose payload lacks a usable manifest, so
  // the caller gets a clear error to fall back on rather than a later TypeError.
  if (!manifest || typeof manifest.id !== 'string' || !Array.isArray(manifest.variants)) {
    throw new Error(`birda returned no usable manifest for ${id}`);
  }
  return manifest;
}
