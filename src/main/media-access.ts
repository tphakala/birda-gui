import path from 'path';
import type { AppSettings } from '$shared/types';

/**
 * Folders that hold clips the app wrote: the configured clip output folder (only
 * when it is an absolute path, so an empty or relative value never turns the
 * working directory into a root) and the default folder under userData.
 */
export function clipRoots(settings: Pick<AppSettings, 'clip_output_dir'>, userData: string): string[] {
  const roots = [path.join(userData, 'clips')];
  const configured = settings.clip_output_dir;
  if (configured && path.isAbsolute(configured)) roots.unshift(path.resolve(configured));
  return roots;
}

/**
 * True when p is inside root, or equal to it when allowEqual is set. The check
 * goes through path.relative, so Windows paths compare case and slash
 * insensitively when pathImpl is path.win32.
 */
export function isInside(
  root: string,
  p: string,
  { allowEqual }: { allowEqual: boolean },
  pathImpl: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path,
): boolean {
  const rel = pathImpl.relative(root, p);
  if (rel === '') return allowEqual;
  if (pathImpl.isAbsolute(rel)) return false; // another drive
  return rel !== '..' && !rel.startsWith('..' + pathImpl.sep);
}
