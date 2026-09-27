/**
 * Date and time in a recording named YYYYMMDD_HHMMSS (AudioMoth style), from a
 * file or folder path: the directory part, trailing separators and one
 * extension are ignored, and the name must match exactly unless allowSuffix is
 * set (the per-file recording start accepts names like 20240501_053000_A).
 * Returns null for any other name or an impossible date or time. The analysis
 * page and the main process both read a source's date this way, so the date
 * the page shows is the one birda gets.
 */
export function parseRecordingName(
  pathOrName: string,
  options: { allowSuffix?: boolean } = {},
): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const base = pathOrName
    .replace(/[\\/]+$/, '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '');
  const pattern = options.allowSuffix
    ? /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/
    : /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;
  const match = pattern.exec(base);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

/**
 * Day of the year (1 to 366) for a month and day, counted in a leap year so
 * February 29 has a place. Computed in UTC, so daylight saving time cannot
 * shift it.
 */
export function dayOfYearOf(month: number, day: number): number {
  return (Date.UTC(2024, month - 1, day) - Date.UTC(2024, 0, 1)) / 86_400_000 + 1;
}
