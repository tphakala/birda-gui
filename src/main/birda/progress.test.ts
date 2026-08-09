import { describe, it, expect } from 'vitest';
import { parseSize, parseProgressLine } from './progress';

describe('parseSize', () => {
  it('parses decimal (SI) units', () => {
    expect(parseSize('58.0 MB')).toBe(58_000_000);
    expect(parseSize('1 GB')).toBe(1_000_000_000);
    expect(parseSize('500 B')).toBe(500);
  });

  it('parses binary (IEC) units', () => {
    expect(parseSize('138 MiB')).toBe(138 * 1024 ** 2);
    expect(parseSize('2 KiB')).toBe(2048);
  });

  it('is case-insensitive and tolerates a missing space', () => {
    expect(parseSize('58 mb')).toBe(58_000_000);
    expect(parseSize('58MB')).toBe(58_000_000);
  });

  it('returns undefined for a matched-but-unknown unit', () => {
    expect(parseSize('5iB')).toBeUndefined();
  });

  it('returns undefined for a multi-dot number rather than NaN', () => {
    expect(parseSize('5.8.0 MB')).toBeUndefined();
  });

  it('returns undefined for unparseable tokens', () => {
    expect(parseSize('bogus')).toBeUndefined();
    expect(parseSize('')).toBeUndefined();
  });
});

describe('parseProgressLine', () => {
  it('extracts percent and byte counts from an indicatif line', () => {
    const p = parseProgressLine('downloading 42% (58.0 MB/138.0 MB)');
    expect(p.line).toBe('downloading 42% (58.0 MB/138.0 MB)');
    expect(p.percent).toBe(42);
    expect(p.bytesDone).toBe(58_000_000);
    expect(p.bytesTotal).toBe(138_000_000);
  });

  it('leaves fields unset when the line has no numbers', () => {
    const p = parseProgressLine('preparing download');
    expect(p.line).toBe('preparing download');
    expect(p.percent).toBeUndefined();
    expect(p.bytesDone).toBeUndefined();
    expect(p.bytesTotal).toBeUndefined();
  });

  it('sets percent alone when byte counts are absent', () => {
    const p = parseProgressLine('verifying 100%');
    expect(p.percent).toBe(100);
    expect(p.bytesDone).toBeUndefined();
    expect(p.bytesTotal).toBeUndefined();
  });

  it('sets byte counts even when no percent is present', () => {
    const p = parseProgressLine('downloading (58.0 MB/138.0 MB)');
    expect(p.percent).toBeUndefined();
    expect(p.bytesDone).toBe(58_000_000);
    expect(p.bytesTotal).toBe(138_000_000);
  });
});
