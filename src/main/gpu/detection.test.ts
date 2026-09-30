import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NVIDIA_VENDOR_ID } from '$shared/constants';

const h = vi.hoisted(() => ({
  execCalls: [] as { command: string; options: { timeout?: number } }[],
}));

vi.mock('electron', () => ({
  app: {
    getGPUInfo: () => Promise.resolve({ gpuDevice: [{ vendorId: 0x10de, deviceId: 1 }] }),
    getPath: () => '/nonexistent',
  },
}));
vi.mock('../cuda/manager', () => ({ getCudaLibsDir: () => '/nonexistent/cuda-libs' }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  exec: vi.fn((command: string, options: { timeout?: number }, callback: (err: Error | null, out: unknown) => void) => {
    h.execCalls.push({ command, options });
    callback(null, { stdout: '', stderr: '' });
    return { pid: 1 };
  }),
}));

const { detectGpuCapabilities } = await import('./detection');

beforeEach(() => {
  h.execCalls = [];
});

describe('detectGpuCapabilities', () => {
  it('gives the nvidia-smi lookup 5 s', async () => {
    expect(NVIDIA_VENDOR_ID).toBe(0x10de);
    const result = await detectGpuCapabilities();
    expect(result.hasNvidiaGpu).toBe(true);
    expect(h.execCalls).toHaveLength(1);
    expect(h.execCalls[0].command).toMatch(/^(which|where) nvidia-smi$/);
    expect(h.execCalls[0].options.timeout).toBe(5000);
  });
});
