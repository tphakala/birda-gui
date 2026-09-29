export interface TypedDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Parse a typed date: D/M/YYYY, D.M.YYYY or D-M-YYYY, or YYYY/M/D, YYYY.M.D or
 * YYYY-M-D. Returns null unless day, month and year are all real, so "15/13/2026"
 * and "15/0/2026" are rejected instead of rolling into a neighbouring year.
 */
export function parseTypedDate(input: string): TypedDate | null {
  const text = input.trim();
  let year: number, month: number, day: number;

  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(text);
    if (!match) return null;
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  // Years 0-99 are read as 19xx by the Date constructor, so accept only four-digit years from 1000.
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}
