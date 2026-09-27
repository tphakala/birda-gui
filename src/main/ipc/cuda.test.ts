import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resetIpc, sentOn } from '../test-support/ipc-harness';

const h = vi.hoisted(() => ({
  settle: null as null | { resolve: (v: unknown) => void; reject: (e: unknown) => void },
}));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);
vi.mock('../cuda/manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cuda/manager')>()),
  downloadCudaLibs: vi.fn(
    (_version: string, onProgress: (downloaded: number, total: number, phase: string) => void) =>
      new Promise((resolve, reject) => {
        onProgress(1, 2, 'downloading');
        h.settle = { resolve, reject };
      }),
  ),
}));

const { registerCudaHandlers } = await import('./cuda');
const { CudaDownloadBusyError, CudaDownloadCancelledError } = await import('../cuda/manager');
registerCudaHandlers();

const download = () => invoke('cuda:download', '1.8.1') as Promise<unknown>;

beforeEach(() => {
  resetIpc();
  h.settle = null;
});

describe('cuda:download', () => {
  it('sends progress and the installed outcome', async () => {
    const run = download();
    h.settle?.resolve({ success: true });
    await run;
    expect(sentOn('cuda:download-progress')).toEqual([{ downloadedBytes: 1, totalBytes: 2, phase: 'downloading' }]);
    expect(sentOn('cuda:download-finished')).toEqual([{ outcome: 'installed', error: undefined }]);
  });

  it.each([
    ['cancelled', new CudaDownloadCancelledError()],
    ['failed', new Error('Download cancelled by user')],
  ])('reports %s', async (outcome, err) => {
    const run = download();
    h.settle?.reject(err);
    await expect(run).rejects.toThrow();
    expect(sentOn('cuda:download-finished')).toMatchObject([{ outcome }]);
  });

  it('reports no outcome for a request refused because a download is running', async () => {
    const run = download();
    h.settle?.reject(new CudaDownloadBusyError());
    await expect(run).rejects.toThrow('already in progress');
    expect(sentOn('cuda:download-finished')).toEqual([]);
  });
});
