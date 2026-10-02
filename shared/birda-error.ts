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
  // The last line of either form wins.
  for (let i = lines.length - 1; i >= 0 && headline === undefined; i--) {
    const line = lines[i] ?? '';
    const found = (/^\s*error:\s*(.+)$/i.exec(line) ?? /\sERROR\s+[^\s:]+(?:::\S+)*:\s*(.+)$/.exec(line))?.[1]?.trim();
    // An error line with no text after the marker says nothing; keep looking.
    if (found) headline = found;
  }
  return {
    headline: headline ?? (lines.length > 0 ? lines[0].trim() : cleaned),
    details: lines.length > 1 ? cleaned : null,
  };
}

/** Birda warnings that turn range filtering off, each with the reason to report. */
const RANGE_FILTER_WARNINGS: readonly (readonly [RegExp, string | null])[] = [
  [
    /Cross-model range filter produced zero matching species/,
    'cross-model range filter produced zero matching species',
  ],
  // A null reason takes the text after the colon.
  [/Range filtering disabled(?: for model '[^']*')?: (.+)$/, null],
];

/** Reason from birda's range filter warning lines ("Range filtering disabled", cross-model zero species), else null. */
export function rangeFilterDisabledReason(line: string): string | null {
  const text = stripAnsi(line);
  for (const [pattern, reason] of RANGE_FILTER_WARNINGS) {
    const match = pattern.exec(text);
    if (match) return reason ?? match[1].trim();
  }
  return null;
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
