import { describe, it, expect } from 'vitest';
import { BIRDA_REPO } from '../../../../shared/constants';
import { formatConfidence } from './utils/format';
import { common_button_cancel } from '../paraglide/messages';

// `import type` is erased before module resolution, so a test that only
// type-imports through an alias passes even when the alias in vitest.config.ts
// is wrong. These value imports resolve each alias and check it lands on the
// same module as the equivalent relative path. Each dynamic import is
// destructured directly so knip still sees which exports are used; a failed
// resolution leaves the value undefined, so a wrong alias fails the assertion.
describe('vitest path aliases', () => {
  it('$shared resolves to shared/', async () => {
    let viaAlias: unknown;
    try {
      const { BIRDA_REPO: value } = await import('$shared/constants');
      viaAlias = value;
    } catch {
      viaAlias = undefined;
    }
    expect(viaAlias).toBe(BIRDA_REPO);
  });

  it('$lib resolves to src/renderer/src/lib/', async () => {
    let viaAlias: unknown;
    try {
      const { formatConfidence: value } = await import('$lib/utils/format');
      viaAlias = value;
    } catch {
      viaAlias = undefined;
    }
    expect(viaAlias).toBe(formatConfidence);
  });

  it('$paraglide resolves to the generated Paraglide output', async () => {
    let viaAlias: unknown;
    try {
      const { common_button_cancel: value } = await import('$paraglide/messages');
      viaAlias = value;
    } catch {
      viaAlias = undefined;
    }
    expect(viaAlias).toBe(common_button_cancel);
  });
});
