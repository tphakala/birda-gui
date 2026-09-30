import { execBirda } from './exec';
import type { BirdaSpeciesResponse } from '$shared/types';

interface BirdaJsonEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload?: Record<string, unknown>;
}

export async function fetchSpecies(
  latitude: number,
  longitude: number,
  week: number,
  threshold?: number,
): Promise<BirdaSpeciesResponse> {
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

  const stdout = await execBirda(args, { errorPrefix: 'birda species command failed: ' });
  let envelope: BirdaJsonEnvelope;
  try {
    envelope = JSON.parse(stdout) as BirdaJsonEnvelope;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse birda species output: ${detail}. Output: ${stdout.slice(0, 200)}`, { cause: e });
  }
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object' || !('species' in payload)) {
    throw new Error('Unexpected payload format from birda species command');
  }
  return payload as unknown as BirdaSpeciesResponse;
}
