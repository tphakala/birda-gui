import { execFile, spawn } from 'child_process';
import { findBirda, registerProcess, unregisterProcess } from './runner';
import type {
  InstalledModel,
  AvailableModel,
  ModelRemovedResult,
  ModelInstalledResult,
  ModelManifest,
  ModelInstallProgress,
} from '$shared/types';

/** Parse an indicatif size token like "58.0 MB" or "138 MiB" into bytes. */
function parseSize(token: string): number | undefined {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(token.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  const factors = new Map<string, number>([
    ['B', 1],
    ['KB', 1e3],
    ['MB', 1e6],
    ['GB', 1e9],
    ['TB', 1e12],
    ['KIB', 1024],
    ['MIB', 1024 ** 2],
    ['GIB', 1024 ** 3],
    ['TIB', 1024 ** 4],
  ]);
  const factor = factors.get(unit);
  return factor === undefined ? undefined : value * factor;
}

interface BirdaJsonEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

async function runBirdaJson(args: string[]): Promise<BirdaJsonEnvelope> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    execFile(birdaPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`birda command failed: ${stderr || err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as BirdaJsonEnvelope);
      } catch {
        reject(new Error(`Failed to parse birda output as JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
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

export async function installModel(
  opts: { id: string; region?: string; variant?: string },
  onProgress?: (progress: ModelInstallProgress) => void,
): Promise<ModelInstalledResult> {
  const birdaPath = await findBirda();
  const args = ['--output-mode', 'json', 'models', 'install', opts.id];
  if (opts.region) args.push('--region', opts.region);
  if (opts.variant) args.push('--variant', opts.variant);
  return new Promise((resolve, reject) => {
    // JSON mode auto-accepts license and defaults "set as default?" to no.
    // No stdin interaction needed: the GUI shows its own license dialog
    // and manages defaults separately via birda:models-set-default.
    const proc = spawn(birdaPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    registerProcess(proc);

    let stdout = '';
    let stderrRemainder = '';

    // stdout = final JSON envelope (not progress)
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // stderr = indicatif progress bars ("<bar> 42% (58.0 MB/138.0 MB)")
    const emit = (line: string) => {
      if (!onProgress) return;
      const percentMatch = /(\d+)%/.exec(line);
      const bytesMatch = /\(([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)\)/i.exec(line);
      const progress: ModelInstallProgress = { line };
      if (percentMatch) progress.percent = Number(percentMatch[1]);
      if (bytesMatch) {
        const done = parseSize(bytesMatch[1]);
        const total = parseSize(bytesMatch[2]);
        if (done !== undefined) progress.bytesDone = done;
        if (total !== undefined) progress.bytesTotal = total;
      }
      onProgress(progress);
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
      unregisterProcess(proc);
      if (stderrRemainder.trim()) {
        emit(stderrRemainder.trim());
      }
      if (code !== 0) {
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
      unregisterProcess(proc);
      reject(new Error(`Model install failed: ${err.message}`));
    });
  });
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
  const payload = envelope.payload as { manifest: ModelManifest };
  return payload.manifest;
}
