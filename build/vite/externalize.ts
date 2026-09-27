import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as PackageJson;

/**
 * Every runtime dependency (including peer and optional) must stay external:
 * it is shipped in node_modules and required at runtime, not bundled.
 */
export function runtimeDepsOf(manifest: PackageJson): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}
const builtins = new Set<string>(builtinModules);

/**
 * Builds the externalize predicate for a list of runtime dependency names.
 * Node builtins, electron (including its subpaths), and every listed
 * dependency (including subpath imports such as `better-sqlite3/lib/foo`) are
 * kept external so they are required at runtime instead of bundled.
 */
export function createIsExternal(deps: readonly string[]): (id: string) => boolean {
  return (id) => {
    if (id === 'electron' || id.startsWith('electron/')) return true;
    if (id.startsWith('node:')) return true;
    if (builtins.has(id)) return true;
    return deps.some((dep) => id === dep || id.startsWith(`${dep}/`));
  };
}

/**
 * Replaces electron-vite's externalizeDepsPlugin for the main and preload
 * bundles, using this package's runtime dependencies. Native modules like
 * better-sqlite3 must never be bundled.
 */
export const isExternal = createIsExternal(runtimeDepsOf(pkg));
