import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseName, formatDetectionDate, formatDetectionTime, parseRecordingStart } from './format';

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

  it('leaves the year out for a date in the current year', () => {
    const year = new Date().getFullYear();
    const now = { audio_file: { recording_start: `${year}-06-15T12:00:00Z` }, start_time: 0 };
    expect(formatDetectionDate(now, 'UTC')).toBe('06-15');
    expect(formatDetectionDate(now, 'Europe/Helsinki')).toBe('06-15');
  });

  describe('around New Year', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('decides the current year on the run clock, not the machine clock', () => {
      // 2026-12-31 23:30Z is already 2027-01-01 in Helsinki.
      vi.useFakeTimers({ now: Date.parse('2026-12-31T23:30:00Z') });
      const d = { audio_file: { recording_start: '2026-12-31T23:00:00Z' }, start_time: 0 };
      expect(formatDetectionDate(d, 'Europe/Helsinki')).toBe('01-01');
      expect(formatDetectionDate(d, 'UTC')).toBe('12-31');
      expect(formatDetectionDate({ ...d, start_time: -86_400 }, 'Europe/Helsinki')).toBe('26-12-31');
    });
  });

  it('shows -- without a recording start', () => {
    expect(formatDetectionDate({ audio_file: null, start_time: 0 }, 'UTC')).toBe('--');
  });
});

describe('baseName', () => {
  it('returns the last segment of a path with either separator', () => {
    expect(baseName('/rec/a.wav')).toBe('a.wav');
    expect(baseName('C:\\rec\\a.wav')).toBe('a.wav');
    expect(baseName('a.wav')).toBe('a.wav');
  });

  it('falls back to the whole path when it ends in a separator', () => {
    expect(baseName('/rec/')).toBe('/rec/');
  });
});
