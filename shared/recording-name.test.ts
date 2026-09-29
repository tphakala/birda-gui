import { describe, expect, it } from 'vitest';
import { dayOfYearOf, detectionHourOf, parseRecordingName } from './recording-name';

describe('parseRecordingName', () => {
  it.each([
    ['20240501_053000.wav', { year: 2024, month: 5, day: 1, hour: 5, minute: 30, second: 0 }],
    ['/rec/20240229_235959.flac', { year: 2024, month: 2, day: 29, hour: 23, minute: 59, second: 59 }],
    ['C:\\rec\\20240501_053000.WAV', { year: 2024, month: 5, day: 1, hour: 5, minute: 30, second: 0 }],
    ['/rec/20240501_053000/', { year: 2024, month: 5, day: 1, hour: 5, minute: 30, second: 0 }],
    ['/rec/20240501_053000', { year: 2024, month: 5, day: 1, hour: 5, minute: 30, second: 0 }],
  ])('reads %s', (name, expected) => {
    expect(parseRecordingName(name)).toEqual(expected);
  });

  it.each([
    '20240501_053000_A.wav',
    '20240501_053000.BirdNET.wav',
    '20240501_0530001.wav',
    '20241345_053000.wav',
    '20230229_053000.wav',
    '20240501_253000.wav',
    '20240501_056000.wav',
    '20240501_053060.wav',
    'recording.wav',
    '',
  ])('rejects %s', (name) => {
    expect(parseRecordingName(name)).toBeNull();
  });
});

describe('parseRecordingName with allowSuffix', () => {
  it('accepts a suffix after the time, and still rejects impossible values', () => {
    expect(parseRecordingName('20240501_053000_A.wav', { allowSuffix: true })).toMatchObject({ month: 5, day: 1 });
    expect(parseRecordingName('20240501_053000_A.wav')).toBeNull();
    expect(parseRecordingName('20241301_053000_A.wav', { allowSuffix: true })).toBeNull();
  });
});

describe('dayOfYearOf', () => {
  it.each([
    [1, 1, 1],
    [2, 29, 60],
    [3, 1, 61],
    [4, 1, 92],
    [10, 31, 305],
    [12, 31, 366],
  ])('month %i day %i is day %i', (month, day, expected) => {
    expect(dayOfYearOf(month, day)).toBe(expected);
  });
});

describe('detectionHourOf', () => {
  it('adds the offset into the file to the hour in the name', () => {
    expect(detectionHourOf('/rec/20240501_053000.wav', 0)).toBe(5);
    expect(detectionHourOf('/rec/20240501_053000.wav', 1800)).toBe(6);
    expect(detectionHourOf('/rec/20240501_233000.wav', 3600)).toBe(0);
  });

  it('reads a name with a suffix the same way', () => {
    expect(detectionHourOf('/rec/20250328_032043_48khz.flac', 3600)).toBe(4);
  });

  it('falls back to the hour within the recording without a valid name', () => {
    expect(detectionHourOf('/rec/recording.wav', 7300)).toBe(2);
    expect(detectionHourOf('/rec/20241345_053000.wav', 7300)).toBe(2);
    expect(detectionHourOf('/rec/recording.wav', 90000)).toBe(1);
  });
});
