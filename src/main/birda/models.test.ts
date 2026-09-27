import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeChild, createFakeBirda, spawnedChild as waitForChild } from '../test-support/fake-child';
import { NO_USER_DATA } from '../test-support/ipc-harness';

vi.mock('electron', () => ({ app: { getPath: () => NO_USER_DATA } }));

const spawned = vi.hoisted(() => ({ children: [] as unknown[] }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(() => {
    const child = new FakeChild();
    spawned.children.push(child);
    return child;
  }),
}));

const { CANCEL_KILL_TIMEOUT_MS, setBirdaPath } = await import('./runner');
const { ModelInstallCancelledError, cancelInstall, getInstallStatus, installModel } = await import('./models');

const fakeBirda = createFakeBirda();
const spawnedChild = () => waitForChild(spawned.children);

beforeEach(() => {
  spawned.children = [];
  setBirdaPath(fakeBirda.path);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fakeBirda.remove();
});

describe('installModel', () => {
  it('waits for close when a started install reports an error', async () => {
    const install = installModel({ id: 'birdnet' });
    const child = await spawnedChild();
    let settled = false;
    install.then(
      () => (settled = true),
      () => (settled = true),
    );
    child.emit('error', new Error('kill EPERM'));
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    child.stdout.write(JSON.stringify({ payload: { id: 'birdnet' } }));
    child.exit(0);
    await expect(install).resolves.toEqual({ id: 'birdnet' });
  });

  it('reports a birda that cannot be found, and a Stop while it is looked for as a cancel', async () => {
    setBirdaPath('/no/such/dir/birda');
    await expect(installModel({ id: 'birdnet' })).rejects.toThrow('not found');

    const stopped = installModel({ id: 'birdnet' });
    cancelInstall();
    await expect(stopped).rejects.toBeInstanceOf(ModelInstallCancelledError);
    expect(spawned.children).toHaveLength(0);
  });

  it('rejects an install whose process failed to start, and frees the slot', async () => {
    const install = installModel({ id: 'birdnet' });
    (await spawnedChild()).failToSpawn();
    await expect(install).rejects.toThrow('Model install failed: spawn birda ENOENT');
    expect(getInstallStatus()).toBeNull();
  });
});

describe('cancelInstall', () => {
  it('leaves no kill timer once a cancelled install exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const install = installModel({ id: 'birdnet' });
    const child = await spawnedChild();
    cancelInstall();
    child.exit(null, 'SIGTERM');
    await expect(install).rejects.toBeInstanceOf(ModelInstallCancelledError);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS);
    expect(child.killCalls).toEqual(['SIGTERM']);
  });

  it('sends SIGKILL to an install that ignores SIGTERM and keeps the slot until it exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const install = installModel({ id: 'birdnet' });
    const child = await spawnedChild();

    expect(cancelInstall()).toBe(true);
    expect(child.signals).toEqual(['SIGTERM']);
    await expect(installModel({ id: 'perch' })).rejects.toThrow('Another model install is already running');

    vi.advanceTimersByTime(CANCEL_KILL_TIMEOUT_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

    child.exit(null, 'SIGKILL');
    await expect(install).rejects.toBeInstanceOf(ModelInstallCancelledError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('frees the slot once the cancelled install exits', async () => {
    const install = installModel({ id: 'birdnet' });
    const child = await spawnedChild();
    cancelInstall();
    child.exit(null, 'SIGTERM');
    await expect(install).rejects.toBeInstanceOf(ModelInstallCancelledError);

    spawned.children = [];
    const next = installModel({ id: 'perch' });
    const nextChild = await spawnedChild();
    nextChild.stdout.write(JSON.stringify({ payload: { id: 'perch' } }));
    nextChild.exit(0);
    await expect(next).resolves.toEqual({ id: 'perch' });
  });

  it('reports the install in flight until it settles', async () => {
    const install = installModel({ id: 'birdnet', region: 'fi' });
    expect(getInstallStatus()).toEqual({ id: 'birdnet', region: 'fi', variant: undefined });
    const child = await spawnedChild();
    child.stdout.write(JSON.stringify({ payload: { id: 'birdnet' } }));
    child.exit(0);
    await install;
    expect(getInstallStatus()).toBeNull();
  });

  it('reports a cancel while birda is being located as a cancel, without spawning', async () => {
    const install = installModel({ id: 'birdnet' });
    cancelInstall();
    await expect(install).rejects.toBeInstanceOf(ModelInstallCancelledError);
    expect(spawned.children).toHaveLength(0);
  });

  it('returns false when no install is running', () => {
    expect(cancelInstall()).toBe(false);
  });
});
