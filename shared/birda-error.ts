/**
 * Helpers that turn raw birda failures into text a person can act on: ANSI
 * escapes and Electron's IPC prefix are removed, the last error line becomes the
 * headline, and known range-filter problems are recognised.
 */

const ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'g');
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

export interface BirdaFailure {
  headline: string;
  /** The full cleaned text when it has more than one line, else null. */
  details: string | null;
}

export function describeBirdaFailure(message: string): BirdaFailure {
  const cleaned = stripAnsi(message).replace(IPC_PREFIX, '').trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim() !== '');
  let headline: string | undefined;
  for (let i = lines.length - 1; i >= 0 && headline === undefined; i--) {
    headline = /^\s*error:\s*(.+)$/i.exec(lines[i] ?? '')?.[1]?.trim();
  }
  for (let i = lines.length - 1; i >= 0 && headline === undefined; i--) {
    headline = /\sERROR\s+[^\s:]+(?:::\S+)*:\s*(.+)$/.exec(lines[i] ?? '')?.[1]?.trim();
  }
  return {
    headline: headline ?? (lines.length > 0 ? lines[0].trim() : cleaned),
    details: lines.length > 1 ? cleaned : null,
  };
}

/** Reason from birda's "Range filtering disabled" warning line, else null. */
export function rangeFilterDisabledReason(line: string): string | null {
  const match = /Range filtering disabled(?: for model '[^']*')?: (.+)$/.exec(stripAnsi(line));
  return match?.[1]?.trim() ?? null;
}

export type SpeciesFetchProblem = 'no_installed_model' | 'no_model' | 'no_range_model';

/** Class of a Fetch Species failure the user can fix, else null. */
export function speciesFetchProblem(message: string): SpeciesFetchProblem | null {
  if (/no model is installed/i.test(message)) return 'no_installed_model';
  if (/no model specified/i.test(message)) return 'no_model';
  if (/requires meta model|has no meta model|no installed model has a range filter/i.test(message)) {
    return 'no_range_model';
  }
  return null;
}
