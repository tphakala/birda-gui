import { describe, it, expect } from 'vitest';
import { BIRDA_REPO } from '../../../../shared/constants';
import { formatConfidence } from './utils/format';
import { common_button_cancel } from '../paraglide/messages';

// `import type` is erased before module resolution, so a test that only
// type-imports through an alias passes even when the alias in vitest.config.ts
// is wrong. These value imports resolve each alias and check it lands on the
// same module as the equivalent relative path. Each dynamic import is
// destructured directly so knip still sees which exports are used. A failed
// resolution is kept as the compared value, so a wrong alias fails the
// assertion and the diff shows the resolution error. Each baseline is checked
// first, so a renamed export cannot make both sides undefined.
describe('vitest path aliases', () => {
  // shared/constants.ts exports primitives, so this case compares by value.
  it('$shared resolves to shared/', async () => {
    expect(BIRDA_REPO).toBeTypeOf('string');
    let viaAlias: unknown;
    try {
      const { BIRDA_REPO: value } = await import('$shared/constants');
      viaAlias = value;
    } catch (error) {
      viaAlias = error;
    }
    expect(viaAlias).toBe(BIRDA_REPO);
  });

  it('$lib resolves to src/renderer/src/lib/', async () => {
    expect(formatConfidence).toBeTypeOf('function');
    let viaAlias: unknown;
    try {
      const { formatConfidence: value } = await import('$lib/utils/format');
      viaAlias = value;
    } catch (error) {
      viaAlias = error;
    }
    expect(viaAlias).toBe(formatConfidence);
  });

  it('$paraglide resolves to the generated Paraglide output', async () => {
    expect(common_button_cancel).toBeTypeOf('function');
    let viaAlias: unknown;
    try {
      const { common_button_cancel: value } = await import('$paraglide/messages');
      viaAlias = value;
    } catch (error) {
      viaAlias = error;
    }
    expect(viaAlias).toBe(common_button_cancel);
  });
});
