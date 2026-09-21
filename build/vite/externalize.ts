import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface PackageJson {
  dependencies?: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as PackageJson;

const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const builtins = new Set<string>([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/**
 * Replaces electron-vite's externalizeDepsPlugin for the main and preload
 * bundles. Node builtins, electron, and every runtime dependency (including
 * subpath imports such as `better-sqlite3/lib/foo`) are kept external so they
 * are required at runtime instead of bundled. Native modules like
 * better-sqlite3 must never be bundled.
 */
export function isExternal(id: string): boolean {
  if (id === 'electron') return true;
  if (id.startsWith('node:')) return true;
  if (builtins.has(id)) return true;
  return runtimeDeps.some((dep) => id === dep || id.startsWith(`${dep}/`));
}
