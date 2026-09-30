/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dirs = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => dirs.userData } }));

const { loadSettings } = await import('./loader');

let file = '';

beforeEach(() => {
  dirs.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'birda-settings-'));
  file = path.join(dirs.userData, 'birda-gui-settings.json');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dirs.userData, { recursive: true, force: true });
});

describe('loadSettings', () => {
  const corruptBackups = () =>
    fs
      .readdirSync(dirs.userData)
      .filter((f) => f.startsWith('birda-gui-settings.json.corrupt'))
      .sort()
      .map((f) => path.join(dirs.userData, f));

  it('returns defaults without moving anything or logging when there is no file', async () => {
    const settings = await loadSettings();
    expect(settings.theme).toBe('system');
    expect(fs.readdirSync(dirs.userData)).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('moves a file with invalid JSON aside and returns defaults', async () => {
    fs.writeFileSync(file, '{ "theme": ');
    const settings = await loadSettings();
    expect(settings.theme).toBe('system');
    expect(fs.existsSync(file)).toBe(false);
    expect(corruptBackups()).toHaveLength(1);
    expect(fs.readFileSync(corruptBackups()[0], 'utf-8')).toBe('{ "theme": ');
  });

  it('keeps every corrupt file when a second one is moved aside', async () => {
    fs.writeFileSync(file, '{ first');
    await loadSettings();
    fs.writeFileSync(file, '{ second');
    await loadSettings();
    const contents = corruptBackups()
      .map((f) => fs.readFileSync(f, 'utf-8'))
      .sort();
    expect(contents).toEqual(['{ first', '{ second']);
  });

  it('appends a counter when the timestamped name is already taken', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-05-01T05:30:00.123Z'));
      fs.writeFileSync(file, '{ one');
      await loadSettings();
      fs.writeFileSync(file, '{ two');
      await loadSettings();
    } finally {
      vi.useRealTimers();
    }
    expect(corruptBackups().map((f) => path.basename(f))).toEqual([
      'birda-gui-settings.json.corrupt-20260501T053000Z',
      'birda-gui-settings.json.corrupt-20260501T053000Z-1',
    ]);
  });

  it.each(['[1,2]', 'null', '"text"', '42'])('moves a file holding %s aside', async (content) => {
    fs.writeFileSync(file, content);
    await loadSettings();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(corruptBackups()[0], 'utf-8')).toBe(content);
  });

  it('leaves a valid file in place and applies its values', async () => {
    const content = JSON.stringify({ theme: 'dark' });
    fs.writeFileSync(file, content);
    const settings = await loadSettings();
    expect(settings.theme).toBe('dark');
    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
    expect(corruptBackups()).toEqual([]);
  });

  it('leaves the file alone and returns defaults on a read error other than a missing file', async () => {
    // A directory at the settings path makes the read fail with EISDIR.
    fs.mkdirSync(file);
    const settings = await loadSettings();
    expect(settings.theme).toBe('system');
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(corruptBackups()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
