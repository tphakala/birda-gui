import type { ModelInstallProgress } from '$shared/types';

/** Parse an indicatif size token like "58.0 MB" or "138 MiB" into bytes. */
export function parseSize(token: string): number | undefined {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(token.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  const factors = new Map<string, number>([
    ['B', 1],
    ['KB', 1e3],
    ['MB', 1e6],
    ['GB', 1e9],
    ['TB', 1e12],
    ['KIB', 1024],
    ['MIB', 1024 ** 2],
    ['GIB', 1024 ** 3],
    ['TIB', 1024 ** 4],
  ]);
  const factor = factors.get(unit);
  return factor === undefined ? undefined : value * factor;
}

/**
 * Parse one indicatif stderr progress line ("<bar> 42% (58.0 MB/138.0 MB)")
 * into structured progress. Fields absent from the line are left unset.
 */
export function parseProgressLine(line: string): ModelInstallProgress {
  const percentMatch = /(\d+)%/.exec(line);
  const bytesMatch = /\(([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)\)/i.exec(line);
  const progress: ModelInstallProgress = { line };
  if (percentMatch) progress.percent = Number(percentMatch[1]);
  if (bytesMatch) {
    const done = parseSize(bytesMatch[1]);
    const total = parseSize(bytesMatch[2]);
    if (done !== undefined) progress.bytesDone = done;
    if (total !== undefined) progress.bytesTotal = total;
  }
  return progress;
}
