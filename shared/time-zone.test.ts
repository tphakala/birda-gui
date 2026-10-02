import { describe, expect, it } from 'vitest';
import {
  clockDayKey,
  currentZoneName,
  displayZone,
  formatIsoWithOffset,
  isValidTimeZone,
  LEGACY_ZONE_NAMES,
  listTimeZones,
  offsetAt,
  offsetLabel,
  parseStoredInstant,
  sharedClockDay,
  wallClockAt,
  zonedWallToUtc,
} from './time-zone';

const wall = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => ({
  year: y,
  month: mo,
  day: d,
  hour: h,
  minute: mi,
  second: s,
});
const utc = (iso: string) => Date.parse(iso);

describe('zonedWallToUtc', () => {
  it.each([
    ['Europe/Helsinki', wall(2026, 3, 29, 3, 30), '2026-03-29T01:30:00Z', 180, 'gap'],
    ['Europe/Helsinki', wall(2026, 10, 25, 3, 30), '2026-10-25T00:30:00Z', 180, 'overlap, earlier'],
    ['America/New_York', wall(2026, 3, 8, 2, 30), '2026-03-08T07:30:00Z', -240, 'gap'],
    ['America/New_York', wall(2026, 11, 1, 1, 30), '2026-11-01T05:30:00Z', -240, 'overlap'],
    ['Pacific/Auckland', wall(2026, 4, 5, 2, 30), '2026-04-04T13:30:00Z', 780, 'overlap, earlier'],
    ['Pacific/Auckland', wall(2026, 9, 27, 2, 30), '2026-09-26T14:30:00Z', 780, 'gap'],
    ['Australia/Lord_Howe', wall(2026, 4, 5, 1, 45), '2026-04-04T14:45:00Z', 660, '30 minute DST'],
    ['Antarctica/Troll', wall(2026, 3, 29, 1, 30), '2026-03-29T01:30:00Z', 120, '2 hour jump'],
    ['Pacific/Kiritimati', wall(2026, 1, 1, 0, 0), '2025-12-31T10:00:00Z', 840, '+14'],
    ['Asia/Kolkata', wall(2026, 5, 15, 12, 0), '2026-05-15T06:30:00Z', 330, '+05:30'],
  ])('%s %j', (zone, w, iso, offset) => {
    const r = zonedWallToUtc(w, zone);
    expect(new Date(r.instantMs).toISOString()).toBe(new Date(utc(iso)).toISOString());
    expect(r.offsetMin).toBe(offset);
  });

  it('passes UTC and fixed offsets through', () => {
    expect(zonedWallToUtc(wall(2026, 5, 15, 5, 30), 'UTC')).toEqual({
      instantMs: utc('2026-05-15T05:30:00Z'),
      offsetMin: 0,
    });
    expect(zonedWallToUtc(wall(2026, 5, 15, 5, 30), { offsetMin: 180 })).toEqual({
      instantMs: utc('2026-05-15T02:30:00Z'),
      offsetMin: 180,
    });
  });
});

describe('offsetAt', () => {
  it('flips across the Helsinki spring transition within one second', () => {
    const transition = utc('2026-03-29T01:00:00Z');
    expect(offsetAt(transition - 1000, 'Europe/Helsinki')).toBe(120);
    expect(offsetAt(transition, 'Europe/Helsinki')).toBe(180);
  });

  it('floors fractional seconds', () => {
    expect(offsetAt(utc('2026-03-29T01:00:00Z') - 1, 'Europe/Helsinki')).toBe(120);
  });
});

describe('wallClockAt', () => {
  it('reads an instant in a zone and in a fixed offset', () => {
    expect(wallClockAt(utc('2026-05-15T02:30:00Z'), 'Europe/Helsinki')).toEqual(wall(2026, 5, 15, 5, 30));
    expect(wallClockAt(utc('2026-05-15T02:30:00Z'), { offsetMin: -210 })).toEqual(wall(2026, 5, 14, 23, 0));
  });
});

describe('formatIsoWithOffset', () => {
  const ms = utc('2026-05-15T02:30:00Z');
  it.each([
    [0, '2026-05-15T02:30:00Z'],
    [180, '2026-05-15T05:30:00+03:00'],
    [-210, '2026-05-14T23:00:00-03:30'],
    [345, '2026-05-15T08:15:00+05:45'],
  ])('offset %i', (offset, expected) => {
    expect(formatIsoWithOffset(ms, offset)).toBe(expected);
  });
});

describe('parseStoredInstant', () => {
  it('reads Z and offset forms', () => {
    expect(parseStoredInstant('2026-05-15T02:30:00Z')).toBe(utc('2026-05-15T02:30:00Z'));
    expect(parseStoredInstant('2026-05-15T05:30:00+03:00')).toBe(utc('2026-05-15T02:30:00Z'));
  });

  it('reads zone-less text as UTC', () => {
    expect(parseStoredInstant('2026-05-15 02:30:00')).toBe(utc('2026-05-15T02:30:00Z'));
    expect(parseStoredInstant('2026-05-15T02:30:00')).toBe(utc('2026-05-15T02:30:00Z'));
  });

  it('returns null for null and garbage', () => {
    expect(parseStoredInstant(null)).toBeNull();
    expect(parseStoredInstant('not a date')).toBeNull();
  });
});

describe('offsetLabel', () => {
  it.each([
    [0, 'UTC'],
    [180, 'UTC+03:00'],
    [-330, 'UTC-05:30'],
    [345, 'UTC+05:45'],
  ])('labels %i as %s', (offset, label) => {
    expect(offsetLabel(offset)).toBe(label);
  });
});

describe('isValidTimeZone', () => {
  it('accepts UTC and IANA names', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Helsinki')).toBe(true);
  });
  it('rejects empty and unknown names', () => {
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});

describe('displayZone', () => {
  it('prefers the run zone, then the file offset, then UTC', () => {
    expect(displayZone('Europe/Helsinki', 60)).toBe('Europe/Helsinki');
    expect(displayZone(null, 180)).toEqual({ offsetMin: 180 });
    expect(displayZone(null, null)).toEqual({ offsetMin: 0 });
    expect(displayZone('Europe/Helsinki', 60, 'filename')).toBe('Europe/Helsinki');
    expect(displayZone('Europe/Helsinki', 180, 'header')).toEqual({ offsetMin: 180 });
  });
});

describe('currentZoneName', () => {
  it.each([...LEGACY_ZONE_NAMES])('maps %s to a zone Intl treats as the same: %s', (legacy, current) => {
    expect(currentZoneName(legacy)).toBe(current);
    for (const t of [Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)]) {
      expect(offsetAt(t, current)).toBe(offsetAt(t, legacy));
    }
  });

  it('passes unknown and current names through', () => {
    expect(currentZoneName('Europe/Helsinki')).toBe('Europe/Helsinki');
    expect(currentZoneName('Mars/Base')).toBe('Mars/Base');
    expect(currentZoneName('UTC')).toBe('UTC');
  });
});

describe('listTimeZones', () => {
  it('has Asia/Kolkata and Europe/Kyiv, not Asia/Calcutta or Europe/Kiev, sorted, without duplicates', () => {
    const zones = listTimeZones();
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Europe/Kyiv');
    expect(zones).not.toContain('Asia/Calcutta');
    expect(zones).not.toContain('Europe/Kiev');
    expect(zones).toEqual([...new Set(zones)].sort());
  });
});

describe('clockDayKey', () => {
  it('keys a fixed zero offset and IANA UTC alike', () => {
    const ms = Date.UTC(2026, 5, 21, 12);
    expect(clockDayKey(ms, 'UTC')).toBe('2026-06-21|UTC');
    expect(clockDayKey(ms, { offsetMin: 0 })).toBe('2026-06-21|UTC');
  });
});

describe('sharedClockDay', () => {
  it('returns the day and zone for one key, null for none or two, and an offset object for a UTC+03:00 key', () => {
    expect(sharedClockDay(['2026-06-21|Europe/Helsinki'])).toEqual({
      year: 2026,
      month: 6,
      day: 21,
      zone: 'Europe/Helsinki',
    });
    expect(sharedClockDay([])).toBeNull();
    expect(sharedClockDay(['2026-06-21|UTC', '2026-06-22|UTC'])).toBeNull();
    expect(sharedClockDay(['2026-06-21|UTC+03:00'])).toEqual({
      year: 2026,
      month: 6,
      day: 21,
      zone: { offsetMin: 180 },
    });
    expect(sharedClockDay(['2026-06-21|UTC'])?.zone).toBe('UTC');
  });
});
