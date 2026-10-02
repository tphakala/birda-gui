import { describe, expect, it } from 'vitest';
import { computeHourlySunPhases } from './sun';

const day = { year: 2026, month: 6, day: 21 };

describe('computeHourlySunPhases', () => {
  it('gives the same phases for a summer day in Europe/Helsinki as for a fixed +03:00 offset', () => {
    expect(computeHourlySunPhases(day, 60.17, 24.94, 'Europe/Helsinki')).toEqual(
      computeHourlySunPhases(day, 60.17, 24.94, { offsetMin: 180 }),
    );
  });

  it('gives the same phases for UTC as for a zero offset', () => {
    expect(computeHourlySunPhases(day, 60.17, 24.94, 'UTC')).toEqual(
      computeHourlySunPhases(day, 60.17, 24.94, { offsetMin: 0 }),
    );
  });

  it('applies the zone offset to the hour columns', () => {
    const helsinki = computeHourlySunPhases(day, 60.17, 24.94, 'Europe/Helsinki');
    const utc = computeHourlySunPhases(day, 60.17, 24.94, 'UTC');
    expect(helsinki).toHaveLength(24);
    expect(helsinki[12]?.phase).toBe('daylight');
    // 02:30 UTC is already after sunrise at this latitude in June, 02:30 in Helsinki is not.
    expect(utc[2]?.phase).toBe('daylight');
    expect(helsinki[2]?.phase).not.toBe('daylight');
  });
});
