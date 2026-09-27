import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInstallFinished } from '$shared/types';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as { channel: string; payload: unknown }[],
  settle: null as null | { resolve: (v: unknown) => void; reject: (e: unknown) => void },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) },
      },
    ],
  },
}));

vi.mock('../birda/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../birda/models')>()),
  installModel: vi.fn(
    (_opts: unknown, onProgress?: (p: unknown) => void) =>
      new Promise((resolve, reject) => {
        onProgress?.({ line: '42%' });
        h.settle = { resolve, reject };
      }),
  ),
}));
vi.mock('../birda/coverageCache', () => ({ registerCoverageUrls: vi.fn() }));
vi.mock('../birda/config', () => ({ setDefaultModel: vi.fn() }));

const { registerModelHandlers } = await import('./models');
const { ModelInstallCancelledError } = await import('../birda/models');
registerModelHandlers();

function install(): Promise<unknown> {
  const fn = h.handlers.get('birda:models-install');
  if (!fn) throw new Error('no handler');
  return fn({}, { id: 'birdnet', region: 'fi' }) as Promise<unknown>;
}

function finishedEvents(): ModelInstallFinished[] {
  return h.sent
    .filter((s) => s.channel === 'birda:models-install-finished')
    .map((s) => s.payload as ModelInstallFinished);
}

beforeEach(() => {
  h.sent = [];
  h.settle = null;
});

describe('birda:models-install', () => {
  it('sends progress and the installed outcome to every window', async () => {
    const run = install();
    h.settle?.resolve({ id: 'birdnet' });
    await run;
    expect(h.sent[0]).toEqual({ channel: 'birda:models-install-progress', payload: { line: '42%' } });
    expect(finishedEvents()).toEqual([
      { request: { id: 'birdnet', region: 'fi', variant: undefined }, outcome: 'installed', error: undefined },
    ]);
  });

  it('reports a cancelled install as cancelled', async () => {
    const run = install();
    h.settle?.reject(new ModelInstallCancelledError());
    await expect(run).rejects.toThrow('Model install cancelled');
    expect(finishedEvents()).toMatchObject([{ outcome: 'cancelled' }]);
  });

  it('reports any other error as failed', async () => {
    const run = install();
    h.settle?.reject(new Error('Model install failed: disk full'));
    await expect(run).rejects.toThrow('disk full');
    expect(finishedEvents()).toMatchObject([{ outcome: 'failed', error: 'Model install failed: disk full' }]);
  });
});
