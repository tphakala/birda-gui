import { describe, expect, it } from 'vitest';
import { parseRecordingName } from './recording-name';

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
    'recording.wav',
    '',
  ])('rejects %s', (name) => {
    expect(parseRecordingName(name)).toBeNull();
  });
});
