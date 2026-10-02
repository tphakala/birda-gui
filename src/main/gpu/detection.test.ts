import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NVIDIA_VENDOR_ID } from '$shared/constants';
import { FakeChild } from '../test-support/fake-child';

const h = vi.hoisted(() => ({
  execCalls: [] as { command: string; options: { timeout?: number } }[],
  children: [] as unknown[],
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
  spawn: vi.fn(() => {
    const child = new FakeChild();
    h.children.push(child);
    return child;
  }),
  exec: vi.fn((command: string, options: { timeout?: number }, callback: (err: Error | null, out: unknown) => void) => {
    h.execCalls.push({ command, options });
    callback(null, { stdout: '', stderr: '' });
    return { pid: 1 };
  }),
}));

const { detectGpuCapabilities } = await import('./detection');

beforeEach(() => {
  h.execCalls = [];
  h.children = [];
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

  it('runs birda providers with NO_COLOR set', async () => {
    const { spawn } = await import('child_process');
    const detection = detectGpuCapabilities('/opt/birda');
    await vi.waitFor(() => {
      expect(h.children).toHaveLength(1);
    });
    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(options?.env?.NO_COLOR).toBe('1');
    const child = h.children[0] as FakeChild;
    child.stdout.write(JSON.stringify({ payload: { providers: [{ name: 'CPU' }] } }));
    child.exit(0);
    await expect(detection).resolves.toMatchObject({ availableProviders: ['CPU'] });
  });
});
