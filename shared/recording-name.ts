/**
 * Date and time in a recording named YYYYMMDD_HHMMSS (AudioMoth style), from a
 * file or folder path: the directory part, trailing separators and one
 * extension are ignored, and the name must match exactly. Returns null for any
 * other name or an impossible date. The analysis page and the main process
 * both read the date this way, so the date the page shows is the one birda gets.
 */
export function parseRecordingName(
  pathOrName: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const base = pathOrName
    .replace(/[\\/]+$/, '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '');
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base);
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
