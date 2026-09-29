import { describe, expect, it } from 'vitest';
import { parseRecordingStart } from './format';

describe('parseRecordingStart', () => {
  it('reads a local date and time from a YYYYMMDD_HHMMSS name', () => {
    expect(parseRecordingStart('/rec/20240501_053000.wav')).toEqual(new Date(2024, 4, 1, 5, 30, 0));
    expect(parseRecordingStart('/rec/20240501_053000/')).toEqual(new Date(2024, 4, 1, 5, 30, 0));
  });

  it('rejects names the main process would not read a date from', () => {
    expect(parseRecordingStart('20240501_053000_A.wav')).toBeNull();
    expect(parseRecordingStart('20241345_053000.wav')).toBeNull();
  });

  it('accepts a suffixed name when allowSuffix is set', () => {
    expect(parseRecordingStart('/rec/20240501_053000_A.wav', { allowSuffix: true })).toEqual(
      new Date(2024, 4, 1, 5, 30, 0),
    );
    expect(parseRecordingStart('/rec/20241345_053000_A.wav', { allowSuffix: true })).toBeNull();
  });
});
