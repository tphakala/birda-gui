/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NO_USER_DATA } from '../test-support/ipc-harness';

vi.mock('electron', () => ({ app: { getPath: () => NO_USER_DATA } }));

const { execBirda } = await import('./exec');
const { setBirdaPath } = await import('./runner');

// Fake birda scripts need a POSIX shell.
const posix = process.platform !== 'win32';
let dir = '';

function fakeBirda(name: string, body: string): string {
  // The runner only accepts a binary called birda, so each script gets its own folder.
  const folder = path.join(dir, name);
  fs.mkdirSync(folder);
  const file = path.join(folder, 'birda');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-exec-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!posix)('execBirda', () => {
  it('resolves with stdout', async () => {
    setBirdaPath(fakeBirda('ok', 'echo hello'));
    await expect(execBirda([])).resolves.toBe('hello\n');
  });

  it('kills a birda that does not finish and says how long it waited', async () => {
    setBirdaPath(fakeBirda('slow', 'exec sleep 5'));
    const started = Date.now();
    await expect(execBirda(['config', 'show'], { timeoutMs: 200 })).rejects.toThrow(
      'birda config show did not finish within 0.2 s',
    );
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('rejects with stderr and the prefix when birda fails', async () => {
    setBirdaPath(fakeBirda('fail', 'echo bad config >&2; exit 3'));
    await expect(execBirda([], { errorPrefix: 'Failed: ' })).rejects.toThrow('Failed: bad config');
  });
});
