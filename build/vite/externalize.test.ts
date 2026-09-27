import { describe, it, expect } from 'vitest';
import { createIsExternal, isExternal, runtimeDepsOf } from './externalize.ts';

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
    // Only electron itself and its subpaths are external: a package that
    // merely shares the prefix is bundled like any other non-dependency.
    expect(createIsExternal([])('electron-log')).toBe(false);
  });

  it('externalizes runtime dependencies and their subpaths', () => {
    // better-sqlite3 is a runtime dependency in package.json.
    expect(isExternal('better-sqlite3')).toBe(true);
    expect(isExternal('better-sqlite3/lib/database.js')).toBe(true);
    expect(isExternal('music-metadata')).toBe(true);
  });

  it('externalizes scoped runtime dependencies and their subpaths', () => {
    // A scoped name embeds a slash, so the package itself, not its scope, is
    // the unit that must match.
    const scoped = createIsExternal(['@scope/pkg']);
    expect(scoped('@scope/pkg')).toBe(true);
    expect(scoped('@scope/pkg/lib/main.js')).toBe(true);
    expect(scoped('@scope')).toBe(false);
    expect(scoped('@scope/other')).toBe(false);
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

  it('treats dependencies, peer and optional dependencies as runtime, not dev dependencies', () => {
    expect(
      runtimeDepsOf({
        dependencies: { a: '1' },
        peerDependencies: { b: '1' },
        optionalDependencies: { c: '1' },
      }),
    ).toEqual(['a', 'b', 'c']);
    expect(runtimeDepsOf({})).toEqual([]);
  });
});
