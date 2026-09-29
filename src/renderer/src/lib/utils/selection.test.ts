import { describe, expect, it } from 'vitest';
import { keepIfPresent, reconcileSelectedRun } from './selection';

describe('keepIfPresent', () => {
  const items = [{ id: 1 }, { id: 4 }];

  it('keeps an id that is still listed', () => {
    expect(keepIfPresent(4, items)).toBe(4);
  });

  it('drops an id that is no longer listed', () => {
    expect(keepIfPresent(2, items)).toBeNull();
    expect(keepIfPresent(1, [])).toBeNull();
  });

  it('keeps null as null', () => {
    expect(keepIfPresent(null, items)).toBeNull();
  });
});

describe('reconcileSelectedRun', () => {
  const run = (id: number, source_path: string, model = 'birdnet') => ({ id, source_path, model });

  it('keeps the selected run while it is listed', () => {
    expect(reconcileSelectedRun(2, run(2, '/a.wav'), [run(2, '/a.wav'), run(3, '/a.wav')])).toBe(2);
  });

  it('moves to the newest run of the same source and model when the selected run is gone', () => {
    const runs = [run(9, '/a.wav', 'perch'), run(7, '/a.wav'), run(6, '/b.wav'), run(5, '/a.wav')];
    expect(reconcileSelectedRun(2, run(2, '/a.wav'), runs)).toBe(7);
    expect(reconcileSelectedRun(2, run(2, '/a.wav'), [...runs].reverse())).toBe(7);
  });

  it('clears the selection when no run of that source and model is left', () => {
    expect(reconcileSelectedRun(2, run(2, '/a.wav'), [run(6, '/b.wav')])).toBeNull();
  });

  it('keeps a listed run even when the previous list did not contain it', () => {
    expect(reconcileSelectedRun(6, undefined, [run(6, '/b.wav')])).toBe(6);
  });

  it('clears the selection when the previous run is unknown', () => {
    expect(reconcileSelectedRun(2, undefined, [run(6, '/b.wav')])).toBeNull();
  });

  it('keeps no selection as no selection', () => {
    expect(reconcileSelectedRun(null, undefined, [run(6, '/b.wav')])).toBeNull();
  });
});
