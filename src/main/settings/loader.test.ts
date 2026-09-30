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
    expect(fs.readFileSync(file + '.corrupt', 'utf-8')).toBe('{ "theme": ');
  });

  it.each(['[1,2]', 'null', '"text"', '42'])('moves a file holding %s aside', async (content) => {
    fs.writeFileSync(file, content);
    await loadSettings();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(file + '.corrupt', 'utf-8')).toBe(content);
  });

  it('leaves a valid file in place and applies its values', async () => {
    const content = JSON.stringify({ theme: 'dark' });
    fs.writeFileSync(file, content);
    const settings = await loadSettings();
    expect(settings.theme).toBe('dark');
    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
    expect(fs.existsSync(file + '.corrupt')).toBe(false);
  });

  it('leaves the file alone and returns defaults on a read error other than a missing file', async () => {
    // A directory at the settings path makes the read fail with EISDIR.
    fs.mkdirSync(file);
    const settings = await loadSettings();
    expect(settings.theme).toBe('system');
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(fs.existsSync(file + '.corrupt')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
