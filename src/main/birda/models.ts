import { execFile, spawn } from 'child_process';
import { findBirda, registerProcess, unregisterProcess } from './runner';
import type { InstalledModel, AvailableModel } from '$shared/types';

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

export async function installModel(name: string, onProgress?: (line: string) => void): Promise<string> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    const proc = spawn(birdaPath, ['models', 'install', name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    registerProcess(proc);

    let stdout = '';
    let stderr = '';
    let stdoutRemainder = '';
    let stderrRemainder = '';

    const reportProgress = (chunk: string, remainder: string): string => {
      if (!onProgress) return remainder + chunk;
      const text = remainder + chunk;
      const parts = text.split('\n');
      const newRemainder = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onProgress(trimmed);
      }
      return newRemainder;
    };

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      stdoutRemainder = reportProgress(text, stdoutRemainder);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      stderrRemainder = reportProgress(text, stderrRemainder);
    });

    // Auto-accept the license prompt; the GUI shows its own acceptance dialog
    // before calling this function.
    // Decline the "Set as default?" prompt — the GUI manages defaults separately
    // via birda:models-set-default IPC channel.
    // Silence EPIPE if the process exits before reading stdin.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    proc.stdin.on('error', () => {});
    proc.stdin.write('accept\nn\n');
    proc.stdin.end();

    proc.on('close', (code) => {
      unregisterProcess(proc);
      if (onProgress) {
        if (stdoutRemainder.trim()) onProgress(stdoutRemainder.trim());
        if (stderrRemainder.trim()) onProgress(stderrRemainder.trim());
      }
      if (code !== 0) {
        reject(new Error(`Model install failed: ${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      unregisterProcess(proc);
      reject(new Error(`Model install failed: ${err.message}`));
    });
  });
}

export async function removeModel(name: string): Promise<void> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    execFile(birdaPath, ['models', 'remove', name], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Failed to remove model: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}

export async function modelInfo(name: string): Promise<unknown> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'info', name]);
  return envelope.payload;
}
