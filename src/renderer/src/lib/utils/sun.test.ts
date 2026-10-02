import { describe, expect, it } from 'vitest';
import type { ClockZone } from '$shared/time-zone';
import { computeHourlySunPhases } from './sun';

const midsummer = { year: 2026, month: 6, day: 21 };
const phases = (zone: ClockZone, day = midsummer) => computeHourlySunPhases({ ...day, zone }, 60.17, 24.94);

describe('computeHourlySunPhases', () => {
  it('gives the same phases for a summer day in Europe/Helsinki as for a fixed +03:00 offset', () => {
    expect(phases('Europe/Helsinki')).toEqual(phases({ offsetMin: 180 }));
  });

  it('gives the same phases for UTC as for a zero offset', () => {
    expect(phases('UTC')).toEqual(phases({ offsetMin: 0 }));
  });

  it('applies the zone offset to the hour columns', () => {
    const helsinki = phases('Europe/Helsinki');
    const utc = phases('UTC');
    expect(helsinki).toHaveLength(24);
    expect(helsinki[12]?.phase).toBe('daylight');
    // 02:30 UTC is already after sunrise at this latitude in June, 02:30 in Helsinki is not.
    expect(utc[2]?.phase).toBe('daylight');
    expect(helsinki[2]?.phase).not.toBe('daylight');
  });

  it('classifies Helsinki winter midnight as night', () => {
    const winter = phases('Europe/Helsinki', { year: 2026, month: 12, day: 21 });
    expect(winter[0]?.phase).toBe('night');
    expect(winter[12]?.phase).toBe('daylight');
  });

  it('has no night at Helsinki midsummer', () => {
    expect(phases('Europe/Helsinki').some((h) => h.phase === 'night')).toBe(false);
  });
});
