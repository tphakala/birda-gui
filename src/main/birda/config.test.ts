import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ execBirda: vi.fn() }));

const { getConfig } = await import('./config');
const { execBirda } = await import('./exec');

beforeEach(() => {
  vi.mocked(execBirda).mockReset();
});

describe('getConfig', () => {
  it('returns the config and its path from the payload, not the whole envelope', async () => {
    vi.mocked(execBirda).mockResolvedValue(
      JSON.stringify({
        spec_version: '1.0',
        event: 'result',
        payload: { result_type: 'config', config_path: '/home/u/config.toml', config: { defaults: { model: null } } },
      }),
    );
    await expect(getConfig()).resolves.toEqual({
      config_path: '/home/u/config.toml',
      config: { defaults: { model: null } },
    });
  });

  it('rejects output without a config', async () => {
    vi.mocked(execBirda).mockResolvedValue('{"payload":{}}');
    await expect(getConfig()).rejects.toThrow('Unexpected birda config output');
  });

  it('rejects output that is not JSON', async () => {
    vi.mocked(execBirda).mockResolvedValue('nope');
    await expect(getConfig()).rejects.toThrow('Failed to parse birda config output');
  });
});
