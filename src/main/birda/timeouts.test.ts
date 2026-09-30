/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; options: { timeout?: number } }[],
  // What the mocked execFile reports: stdout on success, or an error.
  result: { stdout: '{"payload":{"manifest":{"id":"m","variants":[]}}}', fail: false },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getAppPath: () => path.join(os.tmpdir(), 'birda-timeouts-no-such-app'),
    isPackaged: false,
  },
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: vi.fn(
    (
      file: string,
      args: string[],
      options: { timeout?: number },
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      h.calls.push({ file, args, options });
      if (h.result.fail) callback(new Error('not found'), '', '');
      else callback(null, h.result.stdout, '');
      return { pid: 1 };
    },
  ),
}));

const { execBirda } = await import('./exec');
const { findBirda, setBirdaPath } = await import('./runner');
const { getManifest, removeModel } = await import('./models');

let dir = '';
let birdaFile = '';

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-timeouts-'));
  birdaFile = path.join(dir, 'birda');
  fs.writeFileSync(birdaFile, '', { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  h.calls = [];
  h.result = { stdout: '{"payload":{"manifest":{"id":"m","variants":[]}}}', fail: false };
  setBirdaPath(birdaFile);
});

describe.skipIf(process.platform === 'win32')('birda command timeouts', () => {
  it('gives a plain birda command 30 s', async () => {
    await execBirda(['config', 'path']);
    expect(h.calls.map((c) => c.options.timeout)).toEqual([30_000]);
  });

  it('passes an explicit timeout through', async () => {
    await execBirda(['config', 'path'], { timeoutMs: 1234 });
    expect(h.calls.map((c) => c.options.timeout)).toEqual([1234]);
  });

  it('gives models remove --purge 120 s', async () => {
    h.result.stdout = '{"payload":{}}';
    await removeModel('birdnet');
    expect(h.calls.at(-1)?.args).toEqual(['--output-mode', 'json', 'models', 'remove', 'birdnet', '--purge']);
    expect(h.calls.at(-1)?.options.timeout).toBe(120_000);
  });

  it('gives models manifest 120 s', async () => {
    await getManifest('birdnet');
    expect(h.calls.at(-1)?.args).toEqual(['--output-mode', 'json', 'models', 'manifest', 'birdnet']);
    expect(h.calls.at(-1)?.options.timeout).toBe(120_000);
  });

  it('gives the PATH lookup for birda 5 s', async () => {
    setBirdaPath(null);
    h.result.fail = true;
    await expect(findBirda()).rejects.toThrow('birda CLI not found in PATH');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].file).toBe('which');
    expect(h.calls[0].args).toEqual(['birda']);
    expect(h.calls[0].options.timeout).toBe(5000);
  });
});
