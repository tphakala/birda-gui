import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resetIpc } from '../test-support/ipc-harness';

const h = vi.hoisted(() => ({
  settings: { birda_path: '/saved/birda', species_language: 'en', default_confidence: 0.1 },
  setBirdaPath: vi.fn<(p: string | null) => void>(),
  findBirda: vi.fn(() => Promise.resolve('/bin/birda')),
  validateBirdaVersion: vi.fn(() => Promise.resolve({ version: '1.6.0', minVersion: '1.6.0', meetsMinimum: true })),
}));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);
vi.mock('../birda/runner', () => ({
  setBirdaPath: h.setBirdaPath,
  findBirda: h.findBirda,
  validateBirdaVersion: h.validateBirdaVersion,
}));
vi.mock('../birda/config', () => ({ getConfig: vi.fn(), getConfigPath: vi.fn() }));
vi.mock('../birda/models', () => ({ listModels: vi.fn(() => Promise.resolve([])) }));
vi.mock('../labels/label-service', () => ({ buildLabelsPath: vi.fn(), reloadLabels: vi.fn() }));
vi.mock('../settings/store', () => ({
  settingsStore: {
    get: vi.fn(() => Promise.resolve({ ...h.settings })),
    update: vi.fn((patch: Record<string, unknown>) => {
      h.settings = { ...h.settings, ...patch };
      return Promise.resolve({ ...h.settings });
    }),
  },
}));

const { registerSettingsHandlers } = await import('./settings');
await registerSettingsHandlers();
// Vitest clears mock calls between tests, so keep what startup did
const startupPaths = h.setBirdaPath.mock.calls.map(([p]) => p);

const setSettings = (patch: Record<string, unknown>) => invoke('app:set-settings', patch) as Promise<unknown>;
const check = () => invoke('app:check-birda') as Promise<{ available: boolean }>;

beforeEach(() => {
  resetIpc();
});

describe('birda path settings', () => {
  it('applies the saved birda path at startup', () => {
    expect(startupPaths).toEqual(['/saved/birda']);
  });

  it('a changed birda path is checked again', async () => {
    await check();
    const before = h.validateBirdaVersion.mock.calls.length;
    await setSettings({ birda_path: '/other/birda' });
    expect(h.setBirdaPath).toHaveBeenLastCalledWith('/other/birda');
    await check();
    await check();
    expect(h.validateBirdaVersion.mock.calls.length - before).toBe(1);
  });

  it('saving other settings keeps the path and the cached check', async () => {
    await check();
    const before = h.validateBirdaVersion.mock.calls.length;
    await setSettings({ default_confidence: 0.3 });
    expect(h.setBirdaPath).not.toHaveBeenCalled();
    await check();
    expect(h.validateBirdaVersion.mock.calls.length).toBe(before);
  });

  it('clearing the birda path goes back to the bundled or PATH birda', async () => {
    await setSettings({ birda_path: '' });
    expect(h.setBirdaPath).toHaveBeenLastCalledWith(null);
  });
});
