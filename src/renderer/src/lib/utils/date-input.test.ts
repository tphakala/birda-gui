import { describe, expect, it } from 'vitest';
import { parseTypedDate } from './date-input';

describe('parseTypedDate', () => {
  it.each([
    ['15/03/2026', { year: 2026, month: 3, day: 15 }],
    ['5.3.2026', { year: 2026, month: 3, day: 5 }],
    ['15-03-2026', { year: 2026, month: 3, day: 15 }],
    ['2026-03-15', { year: 2026, month: 3, day: 15 }],
    ['2026/3/5', { year: 2026, month: 3, day: 5 }],
    ['  2026.03.15  ', { year: 2026, month: 3, day: 15 }],
    ['29/02/2024', { year: 2024, month: 2, day: 29 }],
  ])('parses %s', (text, expected) => {
    expect(parseTypedDate(text)).toEqual(expected);
  });

  it.each([
    '15/13/2026', // month 13 used to become January 2027
    '15/0/2026', // month 0 used to become December 2025
    '31/04/2026',
    '29/02/2025',
    '0/3/2026',
    '2026-13-01',
    '2026-02-30',
    '15/03/0050', // year below 100 used to become 1950
    '15/03/26',
    'tomorrow',
    '',
  ])('rejects %s', (text) => {
    expect(parseTypedDate(text)).toBeNull();
  });
});
