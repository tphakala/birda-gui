import path from 'path';
import { describe, expect, it } from 'vitest';
import { clipRoots, isInside } from './media-access';

describe('clipRoots', () => {
  const userData = path.resolve('/data/user');

  it('includes the configured absolute folder and the default one', () => {
    const configured = path.resolve('/srv/clips');
    expect(clipRoots({ clip_output_dir: configured }, userData)).toEqual([configured, path.join(userData, 'clips')]);
  });

  it('ignores an empty clip folder', () => {
    expect(clipRoots({ clip_output_dir: '' }, userData)).toEqual([path.join(userData, 'clips')]);
  });

  it('ignores a relative clip folder', () => {
    expect(clipRoots({ clip_output_dir: 'clips' }, userData)).toEqual([path.join(userData, 'clips')]);
    expect(clipRoots({ clip_output_dir: '.' }, userData)).toEqual([path.join(userData, 'clips')]);
  });
});

describe('isInside', () => {
  const posix = path.posix;

  it('accepts a file inside the root and rejects the root itself without allowEqual', () => {
    expect(isInside('/clips', '/clips/a/b.wav', { allowEqual: false }, posix)).toBe(true);
    expect(isInside('/clips', '/clips', { allowEqual: false }, posix)).toBe(false);
    expect(isInside('/clips', '/clips', { allowEqual: true }, posix)).toBe(true);
  });

  it('rejects siblings with a shared prefix and paths that climb out', () => {
    expect(isInside('/clips', '/clips-other/a.wav', { allowEqual: true }, posix)).toBe(false);
    expect(isInside('/clips', '/other/a.wav', { allowEqual: true }, posix)).toBe(false);
    expect(isInside('/clips/a', '/clips/b.wav', { allowEqual: true }, posix)).toBe(false);
  });

  it('accepts a file whose name starts with two dots', () => {
    expect(isInside('/clips', '/clips/..hidden.wav', { allowEqual: false }, posix)).toBe(true);
  });

  it('ignores case and slash direction on Windows', () => {
    const win = path.win32;
    expect(isInside('D:\\Clips', 'd:/clips/a/b.wav', { allowEqual: false }, win)).toBe(true);
    expect(isInside('D:\\Clips', 'D:\\CLIPS', { allowEqual: true }, win)).toBe(true);
    expect(isInside('D:\\Clips', 'D:\\CLIPS', { allowEqual: false }, win)).toBe(false);
  });

  it('rejects another drive on Windows', () => {
    expect(isInside('D:\\Clips', 'E:\\Clips\\a.wav', { allowEqual: true }, path.win32)).toBe(false);
  });
});
