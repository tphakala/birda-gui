import { execFile, spawn } from 'child_process';
import { findBirda } from './runner';
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

export async function installModel(name: string): Promise<string> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    const proc = spawn(birdaPath, ['models', 'install', name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Auto-accept the license prompt; the GUI shows its own acceptance dialog
    // before calling this function.
    proc.stdin.write('accept\n');
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Model install failed: ${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Model install failed: ${err.message}`));
    });
  });
}

export async function modelInfo(name: string): Promise<unknown> {
  const envelope = await runBirdaJson(['--output-mode', 'json', 'models', 'info', name]);
  return envelope.payload;
}
