import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resetIpc } from '../test-support/ipc-harness';

const h = vi.hoisted(() => ({
  findBirda: vi.fn<() => Promise<string>>(),
  detect: vi.fn((_birdaPath?: string) =>
    Promise.resolve({ hasNvidiaGpu: false, cudaLibrariesFound: false, availableProviders: ['CPU'], platform: 'linux' }),
  ),
}));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);
vi.mock('../birda/runner', () => ({ findBirda: h.findBirda }));
vi.mock('../gpu/detection', () => ({ detectGpuCapabilities: h.detect }));

const { registerGpuHandlers } = await import('./gpu');
registerGpuHandlers();

beforeEach(() => {
  resetIpc();
  h.findBirda.mockReset();
  h.detect.mockClear();
});

describe('gpu:detect-capabilities', () => {
  it('asks the birda that analyses use for its providers', async () => {
    h.findBirda.mockResolvedValue('/opt/birda/birda');
    await invoke('gpu:detect-capabilities');
    expect(h.detect).toHaveBeenCalledWith('/opt/birda/birda');
  });

  it('lists CPU only when no birda can be found', async () => {
    h.findBirda.mockRejectedValue(new Error('birda not found'));
    const result = await (invoke('gpu:detect-capabilities') as Promise<{ availableProviders: string[] }>);
    expect(h.detect).toHaveBeenCalledWith(undefined);
    expect(result.availableProviders).toEqual(['CPU']);
  });
});
