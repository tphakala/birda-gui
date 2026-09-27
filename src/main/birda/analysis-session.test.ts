import { describe, expect, it, vi } from 'vitest';
import { AnalysisLock, AnalysisSession, classifyExit } from './analysis-session';

function fakeHandle() {
  return { cancel: vi.fn(), stderrLog: () => 'stderr text' };
}

describe('classifyExit', () => {
  it('treats only exit code 0 as success', () => {
    expect(classifyExit(0, false)).toBe('success');
    expect(classifyExit(0, true)).toBe('success');
  });

  it('treats a signal exit without a cancel as a failure', () => {
    expect(classifyExit(null, false)).toBe('failed');
  });

  it('treats any non-zero exit after a cancel as the cancel', () => {
    expect(classifyExit(null, true)).toBe('cancelled');
    expect(classifyExit(1, true)).toBe('cancelled');
  });

  it('treats a non-zero exit without a cancel as a failure', () => {
    expect(classifyExit(2, false)).toBe('failed');
  });
});

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

  it('reads stderr from the attached handle', () => {
    const session = new AnalysisSession('/rec');
    expect(session.stderrLog()).toBe('');
    session.attach(fakeHandle());
    expect(session.stderrLog()).toBe('stderr text');
  });
});

describe('AnalysisLock', () => {
  it('refuses a second analysis while one holds the lock', () => {
    const lock = new AnalysisLock();
    lock.acquire('/a');
    expect(() => lock.acquire('/b')).toThrow('already running');
  });

  it('keeps the lock through a cancel until the session releases it', () => {
    const lock = new AnalysisLock();
    const session = lock.acquire('/a');
    session.cancel();
    expect(lock.status()).toEqual({ state: 'stopping', sourcePath: '/a' });
    expect(() => lock.acquire('/b')).toThrow('already running');

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
    expect(lock.status()).toEqual({ state: 'running', sourcePath: '/b' });
  });
});
