import { describe, expect, it } from 'vitest';
import { formatDetectionDate, formatDetectionTime, parseRecordingStart } from './format';

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

describe('formatDetectionTime', () => {
  const detection = { audio_file: { recording_start: '2026-05-15T02:30:00Z' }, start_time: 0 };

  it('shows the time in the run zone', () => {
    expect(formatDetectionTime(detection, 'Europe/Helsinki')).toBe('05:30:00');
    expect(formatDetectionTime(detection, { offsetMin: 0 })).toBe('02:30:00');
  });

  it('adds the offset into the file', () => {
    expect(formatDetectionTime({ ...detection, start_time: 90 }, 'Europe/Helsinki')).toBe('05:31:30');
  });

  it('shows -- without a recording start', () => {
    expect(formatDetectionTime({ audio_file: null, start_time: 0 }, 'UTC')).toBe('--');
    expect(formatDetectionTime({ audio_file: { recording_start: null }, start_time: 0 }, 'UTC')).toBe('--');
  });
});

describe('formatDetectionDate', () => {
  it('uses the date in the run zone, with the year when it is not the current year', () => {
    const late = { audio_file: { recording_start: '2020-05-15T22:30:00Z' }, start_time: 0 };
    expect(formatDetectionDate(late, 'UTC')).toBe('20-05-15');
    expect(formatDetectionDate(late, 'Europe/Helsinki')).toBe('20-05-16');
  });

  it('shows -- without a recording start', () => {
    expect(formatDetectionDate({ audio_file: null, start_time: 0 }, 'UTC')).toBe('--');
  });
});
