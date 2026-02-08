import { execFile } from 'child_process';
import { findBirda } from './runner';
import type { BirdaSpeciesResponse } from '$shared/types';

interface BirdaJsonEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

export async function fetchSpecies(
  latitude: number,
  longitude: number,
  week: number,
  threshold?: number,
): Promise<BirdaSpeciesResponse> {
  const birdaPath = await findBirda();
  const args = [
    '--output-mode',
    'json',
    'species',
    '--lat',
    String(latitude),
    '--lon',
    String(longitude),
    '--week',
    String(week),
  ];
  if (threshold !== undefined) {
    args.push('--threshold', String(threshold));
  }

  return new Promise((resolve, reject) => {
    execFile(birdaPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`birda species command failed: ${stderr || err.message}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as BirdaJsonEnvelope;
        resolve(envelope.payload as unknown as BirdaSpeciesResponse);
      } catch {
        reject(new Error(`Failed to parse birda species output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}
