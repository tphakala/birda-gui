import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const { NO_USER_DATA } = await import('../test-support/ipc-harness');
  return { app: { getPath: () => NO_USER_DATA, getGPUInfo: vi.fn() } };
});

const { downloadError, CudaDownloadCancelledError } = await import('./manager');

describe('downloadError', () => {
  it('reports any error after a Cancel as the cancel, such as the stream aborting', () => {
    const aborted = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    expect(downloadError(aborted, true)).toBeInstanceOf(CudaDownloadCancelledError);
  });

  it('keeps the error of a download that was not cancelled', () => {
    const err = new Error('getaddrinfo ENOTFOUND');
    expect(downloadError(err, false)).toBe(err);
    expect(downloadError('text', false)).toEqual(new Error('text'));
  });
});
