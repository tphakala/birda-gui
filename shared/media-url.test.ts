/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'url';
import { mediaUrlToPath, toBirdaMediaUrl } from './media-url';

describe('birda-media URL round trip', () => {
  it.each([
    '/rec/site/x.wav',
    '/rec/Site #3/x.wav',
    '/rec/what?/x.wav',
    '/rec/100% sure/x.wav',
    '/rec/Ääni ja kuva/x.wav',
    '/rec/a b/c&d=e/x.wav',
  ])('restores the posix path %s', (p) => {
    expect(mediaUrlToPath(toBirdaMediaUrl(p), 'linux')).toBe(p);
  });

  it('restores a Windows drive path with forward slashes', () => {
    expect(mediaUrlToPath(toBirdaMediaUrl('D:\\clips\\Site #3\\x.wav'), 'win32')).toBe('D:/clips/Site #3/x.wav');
  });

  it('keeps the leading slash off win32 only for drive letters', () => {
    expect(mediaUrlToPath(toBirdaMediaUrl('/rec/x.wav'), 'win32')).toBe('/rec/x.wav');
  });

  it('gives pathToFileURL a path that still resolves to the same file', () => {
    const p = '/rec/Site #3/what?/x.wav';
    const back = fileURLToPath(pathToFileURL(mediaUrlToPath(toBirdaMediaUrl(p), 'linux')));
    expect(back).toBe(p);
  });
});
