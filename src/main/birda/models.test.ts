import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeChild } from './fake-child';

vi.mock('electron', () => ({ app: { getPath: () => path.join(os.tmpdir(), 'birda-gui-test-no-such-dir') } }));

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
const { cancelInstall, installModel } = await import('./models');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-models-test-'));
const birdaPath = path.join(binDir, 'birda');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture under a fresh temp dir
fs.writeFileSync(birdaPath, '');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture under a fresh temp dir
fs.chmodSync(birdaPath, 0o755);

async function spawnedChild(): Promise<FakeChild> {
  await vi.waitFor(() => {
    expect(spawned.children).toHaveLength(1);
  });
  return spawned.children[0] as FakeChild;
}

beforeEach(() => {
  spawned.children = [];
  setBirdaPath(birdaPath);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe('cancelInstall', () => {
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
    await expect(install).rejects.toThrow('Model install cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('frees the slot once the cancelled install exits', async () => {
    const install = installModel({ id: 'birdnet' });
    const child = await spawnedChild();
    cancelInstall();
    child.exit(null, 'SIGTERM');
    await expect(install).rejects.toThrow('Model install cancelled');

    spawned.children = [];
    const next = installModel({ id: 'perch' });
    const nextChild = await spawnedChild();
    nextChild.stdout.write(JSON.stringify({ payload: { id: 'perch' } }));
    nextChild.exit(0);
    await expect(next).resolves.toEqual({ id: 'perch' });
  });

  it('returns false when no install is running', () => {
    expect(cancelInstall()).toBe(false);
  });
});
