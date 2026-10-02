import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAvailableModels = vi.fn();
vi.mock('./ipc', () => ({ listAvailableModels }));

// The helper caches the list in module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return (await import('./models')).modelDisplayName;
}

describe('modelDisplayName', () => {
  beforeEach(() => {
    listAvailableModels.mockReset();
  });

  it('gives the display name of a known model', async () => {
    listAvailableModels.mockResolvedValue([{ id: 'birdnet-v24', name: 'BirdNET v2.4' }]);
    const modelDisplayName = await load();
    expect(await modelDisplayName('birdnet-v24')).toBe('BirdNET v2.4');
  });

  it('gives the id of an unknown model', async () => {
    listAvailableModels.mockResolvedValue([{ id: 'birdnet-v24', name: 'BirdNET v2.4' }]);
    const modelDisplayName = await load();
    expect(await modelDisplayName('perch-v2')).toBe('perch-v2');
  });

  it('gives the id when the list cannot be read, and loads it again on the next call', async () => {
    listAvailableModels
      .mockRejectedValueOnce(new Error('birda failed'))
      .mockResolvedValueOnce([{ id: 'birdnet-v24', name: 'BirdNET v2.4' }]);
    const modelDisplayName = await load();
    expect(await modelDisplayName('birdnet-v24')).toBe('birdnet-v24');
    expect(await modelDisplayName('birdnet-v24')).toBe('BirdNET v2.4');
    expect(listAvailableModels).toHaveBeenCalledTimes(2);
  });

  it('loads the list once for several lookups', async () => {
    listAvailableModels.mockResolvedValue([
      { id: 'birdnet-v24', name: 'BirdNET v2.4' },
      { id: 'perch-v2', name: 'Perch v2' },
    ]);
    const modelDisplayName = await load();
    expect(await modelDisplayName('birdnet-v24')).toBe('BirdNET v2.4');
    expect(await modelDisplayName('perch-v2')).toBe('Perch v2');
    expect(listAvailableModels).toHaveBeenCalledTimes(1);
  });
});
