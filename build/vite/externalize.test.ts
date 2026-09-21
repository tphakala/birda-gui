import { describe, it, expect } from 'vitest';
import { isExternal } from './externalize';

describe('isExternal', () => {
  it('externalizes Node builtins, bare and node: prefixed', () => {
    expect(isExternal('fs')).toBe(true);
    expect(isExternal('path')).toBe(true);
    expect(isExternal('node:fs')).toBe(true);
    expect(isExternal('node:child_process')).toBe(true);
  });

  it('externalizes node:-prefixed specifiers not in the builtin snapshot', () => {
    // The node: short-circuit must fire even for a module absent from the
    // build-time builtinModules list; otherwise a future node: builtin bundles.
    expect(isExternal('node:some-future-module')).toBe(true);
  });

  it('externalizes electron and its subpaths', () => {
    expect(isExternal('electron')).toBe(true);
    expect(isExternal('electron/main')).toBe(true);
  });

  it('externalizes runtime dependencies and their subpaths', () => {
    // better-sqlite3 is a runtime dependency in package.json.
    expect(isExternal('better-sqlite3')).toBe(true);
    expect(isExternal('better-sqlite3/lib/database.js')).toBe(true);
    expect(isExternal('music-metadata')).toBe(true);
  });

  it('externalizes scoped runtime dependencies and their subpaths', () => {
    // @electron/rebuild is a runtime dependency; the scoped name embeds a slash.
    expect(isExternal('@electron/rebuild')).toBe(true);
    expect(isExternal('@electron/rebuild/lib/main.js')).toBe(true);
    expect(isExternal('@electron')).toBe(false);
  });

  it('does not externalize a package that only shares a name prefix with a dependency', () => {
    // The trailing slash in the subpath check is the point: an unrelated
    // same-prefix package must be bundled, not externalized (would fail to resolve).
    expect(isExternal('better-sqlite3-extra')).toBe(false);
    expect(isExternal('zod-plugin')).toBe(false);
  });

  it('does not externalize dev dependencies, local imports, or an empty id', () => {
    expect(isExternal('vite')).toBe(false); // devDependency, bundled if used
    expect(isExternal('./coverageCache')).toBe(false);
    expect(isExternal('$shared/types')).toBe(false);
    expect(isExternal('')).toBe(false);
  });
});
