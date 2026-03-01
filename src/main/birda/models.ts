import { execFile, spawn } from 'child_process';
import { findBirda, registerProcess, unregisterProcess } from './runner';
import type { InstalledModel, AvailableModel, ModelRemovedResult, ModelInstalledResult } from '$shared/types';

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

export async function installModel(name: string, onProgress?: (line: string) => void): Promise<ModelInstalledResult> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    // JSON mode auto-accepts license and defaults "set as default?" to no.
    // No stdin interaction needed — the GUI shows its own license dialog
    // and manages defaults separately via birda:models-set-default.
    const proc = spawn(birdaPath, ['--output-mode', 'json', 'models', 'install', name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    registerProcess(proc);

    let stdout = '';
    let stderrRemainder = '';

    // stdout = final JSON envelope (not progress)
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // stderr = indicatif progress bars
    proc.stderr.on('data', (data: Buffer) => {
      if (!onProgress) return;
      const combined = stderrRemainder + data.toString();
      const parts = combined.split('\n');
      stderrRemainder = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onProgress(trimmed);
      }
    });

    proc.stdin.end();

    proc.on('close', (code) => {
      unregisterProcess(proc);
      if (onProgress && stderrRemainder.trim()) {
        onProgress(stderrRemainder.trim());
      }
      if (code !== 0) {
        reject(new Error(`Model install failed: ${stdout}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as BirdaJsonEnvelope;
        const payload = envelope.payload as unknown as ModelInstalledResult;
        resolve({
          id: payload.id,
          set_as_default: payload.set_as_default,
          model_path: payload.model_path,
          labels_path: payload.labels_path,
        });
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
  const payload = envelope.payload as unknown as ModelRemovedResult;
  return {
    id: payload.id,
    purge_requested: payload.purge_requested,
    new_default: payload.new_default,
  };
}

export async function modelInfo(name: string): Promise<unknown> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'info', name]);
  return envelope.payload;
}
