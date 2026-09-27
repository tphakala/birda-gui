import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BIRDA_CLI_VERSION } from '$shared/constants';

describe('BIRDA_CLI_VERSION', () => {
  it('matches the bundled CLI version in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as {
      birdaCli: { version: string };
    };
    expect(BIRDA_CLI_VERSION).toBe(pkg.birdaCli.version);
  });
});
