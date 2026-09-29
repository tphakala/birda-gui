import { describe, expect, it } from 'vitest';
import { applyProgressEvent, fileStatusOf, type ProgressCounts } from './analysis-progress';
import type { BirdaEventEnvelope } from './types';

const event = (name: string, payload: unknown): BirdaEventEnvelope => ({
  spec_version: '1.1',
  timestamp: '',
  event: name,
  payload,
});

describe('applyProgressEvent', () => {
  it('counts files, failures and detections, and takes birda’s final total', () => {
    const counts: ProgressCounts = { totalFiles: 0, filesProcessed: 0, filesFailed: 0, totalDetections: 0 };
    for (const e of [
      event('pipeline_started', { total_files: 3 }),
      event('file_completed', { file: 'a.wav', status: 'processed', detections: 4 }),
      event('file_completed', { file: 'b.wav', status: 'failed' }),
      event('file_completed', { file: 'c.wav', status: 'skipped' }),
      event('progress', { file: { path: 'd.wav' } }),
    ]) {
      applyProgressEvent(counts, e);
    }
    expect(counts).toEqual({ totalFiles: 3, filesProcessed: 3, filesFailed: 1, totalDetections: 4 });

    applyProgressEvent(counts, event('pipeline_completed', { total_detections: 7 }));
    expect(counts.totalDetections).toBe(7);
  });
});

describe('fileStatusOf', () => {
  it.each([
    ['processed', 'completed'],
    ['failed', 'failed'],
    ['skipped', 'skipped'],
    ['locked', 'skipped'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(fileStatusOf(status)).toBe(expected);
  });
});
