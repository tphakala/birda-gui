import { describe, expect, it, vi } from 'vitest';
import { AnalysisLock, AnalysisSession } from './analysis-session';

function fakeHandle() {
  return { cancel: vi.fn() };
}

describe('AnalysisSession', () => {
  it('passes a cancel requested before attach on to the handle', () => {
    const session = new AnalysisSession('/rec');
    session.cancel();
    const handle = fakeHandle();
    session.attach(handle);
    expect(handle.cancel).toHaveBeenCalledOnce();
    expect(session.cancelRequested).toBe(true);
  });

  it('cancels an attached handle', () => {
    const session = new AnalysisSession('/rec');
    const handle = fakeHandle();
    session.attach(handle);
    expect(handle.cancel).not.toHaveBeenCalled();
    session.cancel();
    expect(handle.cancel).toHaveBeenCalledOnce();
  });
});

describe('AnalysisLock', () => {
  it('reports a copy of the session progress', () => {
    const lock = new AnalysisLock();
    const session = lock.acquire('/a');
    session.progress.totalFiles = 2;
    session.progress.completedFiles.push({ file: 'a.wav', status: 'processed' });
    const status = lock.status();
    session.progress.totalFiles = 3;
    session.progress.completedFiles.push({ file: 'b.wav', status: 'failed' });
    expect(status).toMatchObject({
      progress: { totalFiles: 2, completedFiles: [{ file: 'a.wav', status: 'processed' }] },
    });
  });

  it('refuses a second analysis while one holds the lock', () => {
    const lock = new AnalysisLock();
    lock.acquire('/a');
    expect(() => lock.acquire('/b')).toThrow('already running');
  });

  it('keeps the lock through a cancel until the session releases it', () => {
    const lock = new AnalysisLock();
    const session = lock.acquire('/a');
    session.cancel();
    expect(lock.status()).toEqual({
      state: 'stopping',
      sourcePath: '/a',
      progress: { totalFiles: 0, filesProcessed: 0, filesFailed: 0, totalDetections: 0, completedFiles: [] },
    });
    expect(() => lock.acquire('/b')).toThrow('still stopping');

    lock.release(session);
    expect(lock.status()).toEqual({ state: 'idle' });
    expect(lock.acquire('/b').sourcePath).toBe('/b');
  });

  it('ignores a release from a session that no longer holds the lock', () => {
    const lock = new AnalysisLock();
    const first = lock.acquire('/a');
    lock.release(first);
    const second = lock.acquire('/b');

    lock.release(first);
    expect(lock.active).toBe(second);
    expect(lock.status()).toEqual({
      state: 'running',
      sourcePath: '/b',
      progress: { totalFiles: 0, filesProcessed: 0, filesFailed: 0, totalDetections: 0, completedFiles: [] },
    });
  });
});
