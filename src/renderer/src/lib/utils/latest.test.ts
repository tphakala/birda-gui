import { describe, expect, it } from 'vitest';
import { latestRequest } from './latest';

describe('latestRequest', () => {
  it('keeps a request current until the next one begins', () => {
    const begin = latestRequest();
    const first = begin();
    expect(first()).toBe(true);
    expect(first()).toBe(true);
    begin();
    expect(first()).toBe(false);
  });

  it('only the newest of overlapping requests is current', () => {
    const begin = latestRequest();
    const first = begin();
    const second = begin();
    const third = begin();
    expect([first(), second(), third()]).toEqual([false, false, true]);
  });

  it('gates are independent of each other', () => {
    const beginA = latestRequest();
    const beginB = latestRequest();
    const a = beginA();
    beginB();
    expect(a()).toBe(true);
  });
});
