import { describe, expect, it, vi } from 'vitest';
import { supportsWebGL2 } from './webgl';

describe('supportsWebGL2', () => {
  it('is false when the canvas has no webgl2 context', () => {
    expect(supportsWebGL2(() => ({ getContext: () => null }))).toBe(false);
  });

  it('is false when getContext throws', () => {
    const createCanvas = () => ({
      getContext: () => {
        throw new Error('no gpu');
      },
    });
    expect(supportsWebGL2(createCanvas)).toBe(false);
  });

  it('is true and frees the probe context when the lose-context extension exists', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const getContext = vi.fn(() => gl);
    expect(supportsWebGL2(() => ({ getContext }))).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('is true when there is no lose-context extension', () => {
    const gl = { getExtension: () => null };
    expect(supportsWebGL2(() => ({ getContext: () => gl }))).toBe(true);
  });
});
