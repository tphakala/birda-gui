import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resetIpc, sentOn } from '../test-support/ipc-harness';
import type { ModelInstallFinished } from '$shared/types';

const h = vi.hoisted(() => ({
  settle: null as null | { resolve: (v: unknown) => void; reject: (e: unknown) => void },
}));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);

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
const { ModelInstallBusyError, ModelInstallCancelledError } = await import('../birda/models');
registerModelHandlers();

const install = () => invoke('birda:models-install', { id: 'birdnet', region: 'fi' }) as Promise<unknown>;
const finishedEvents = () => sentOn('birda:models-install-finished') as ModelInstallFinished[];

beforeEach(() => {
  resetIpc();
  h.settle = null;
});

describe('birda:models-install', () => {
  it('sends progress and the installed outcome', async () => {
    const run = install();
    h.settle?.resolve({ id: 'birdnet' });
    await run;
    expect(sentOn('birda:models-install-progress')).toEqual([{ line: '42%' }]);
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

  it('reports any other error as failed, even one whose message mentions a cancel', async () => {
    const run = install();
    h.settle?.reject(new Error('Model install cancelled'));
    await expect(run).rejects.toThrow('Model install cancelled');
    expect(finishedEvents()).toMatchObject([{ outcome: 'failed', error: 'Model install cancelled' }]);
  });

  it('reports no outcome for a request refused because another install is running', async () => {
    const run = install();
    h.settle?.reject(new ModelInstallBusyError());
    await expect(run).rejects.toThrow('already running');
    expect(finishedEvents()).toEqual([]);
  });
});

describe('birda:models-install-status', () => {
  it('reports the install in flight', async () => {
    const models = await import('../birda/models');
    const request = { id: 'birdnet', region: 'fi', variant: undefined };
    vi.spyOn(models, 'getInstallStatus').mockReturnValueOnce(request);
    expect(invoke('birda:models-install-status')).toEqual(request);
  });
});
