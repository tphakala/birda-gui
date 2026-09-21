import { describe, it, expect } from 'vitest';
import { isExternal } from './externalize';

describe('isExternal', () => {
  it('externalizes Node builtins, bare and node: prefixed', () => {
    expect(isExternal('fs')).toBe(true);
    expect(isExternal('path')).toBe(true);
    expect(isExternal('node:fs')).toBe(true);
    expect(isExternal('node:child_process')).toBe(true);
  });

  it('externalizes electron', () => {
    expect(isExternal('electron')).toBe(true);
  });

  it('externalizes runtime dependencies and their subpaths', () => {
    // better-sqlite3 is a runtime dependency in package.json.
    expect(isExternal('better-sqlite3')).toBe(true);
    expect(isExternal('better-sqlite3/lib/database.js')).toBe(true);
    expect(isExternal('music-metadata')).toBe(true);
  });

  it('does not externalize dev dependencies or local imports', () => {
    expect(isExternal('vite')).toBe(false); // devDependency, bundled if used
    expect(isExternal('./coverageCache')).toBe(false);
    expect(isExternal('$shared/types')).toBe(false);
  });
});
