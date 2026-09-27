import { describe, expect, it } from 'vitest';
import { classifyExit } from './process-exit';

describe('classifyExit', () => {
  it('treats only exit code 0 as success', () => {
    expect(classifyExit(0, false)).toBe('success');
    expect(classifyExit(0, true)).toBe('success');
  });

  it('treats a signal exit without a cancel as a failure', () => {
    expect(classifyExit(null, false)).toBe('failed');
  });

  it('treats any non-zero exit after a cancel as the cancel', () => {
    expect(classifyExit(null, true)).toBe('cancelled');
    expect(classifyExit(1, true)).toBe('cancelled');
  });

  it('treats a non-zero exit without a cancel as a failure', () => {
    expect(classifyExit(2, false)).toBe('failed');
  });
});
