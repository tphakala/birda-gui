import { beforeEach, describe, expect, it, vi } from 'vitest';

const supportsWebGL2 = vi.fn<() => boolean>();
vi.mock('./webgl', () => ({ supportsWebGL2 }));
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));

// The result is kept in module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return (await import('./maplibre')).mapAvailable;
}

describe('mapAvailable', () => {
  beforeEach(() => {
    supportsWebGL2.mockReset();
  });

  it('probes again after a failure, so a temporary one does not stick', async () => {
    supportsWebGL2.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const mapAvailable = await load();
    expect(mapAvailable()).toBe(false);
    expect(mapAvailable()).toBe(true);
  });

  it('keeps a success without probing again', async () => {
    supportsWebGL2.mockReturnValue(true);
    const mapAvailable = await load();
    expect(mapAvailable()).toBe(true);
    expect(mapAvailable()).toBe(true);
    expect(supportsWebGL2).toHaveBeenCalledTimes(1);
  });
});
