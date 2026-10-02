import { describe, expect, it } from 'vitest';
import {
  displayZone,
  formatIsoWithOffset,
  isValidTimeZone,
  offsetAt,
  parseStoredInstant,
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
  });
});
