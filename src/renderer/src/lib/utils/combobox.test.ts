import { describe, expect, it } from 'vitest';
import { comboboxKey } from './combobox';

describe('comboboxKey', () => {
  it('ArrowDown opens a closed list on the first option', () => {
    expect(comboboxKey('ArrowDown', { open: false, active: -1 }, 3)).toEqual({
      kind: 'move',
      active: 0,
    });
  });

  it('ArrowDown wraps from the last option to the first', () => {
    expect(comboboxKey('ArrowDown', { open: true, active: 2 }, 3)).toEqual({
      kind: 'move',
      active: 0,
    });
  });

  it('ArrowUp opens a closed list on the last option', () => {
    expect(comboboxKey('ArrowUp', { open: false, active: -1 }, 3)).toEqual({
      kind: 'move',
      active: 2,
    });
  });

  it('ArrowUp wraps from the first option to the last', () => {
    expect(comboboxKey('ArrowUp', { open: true, active: 0 }, 3)).toEqual({
      kind: 'move',
      active: 2,
    });
  });

  it('arrow keys are ignored without results', () => {
    expect(comboboxKey('ArrowDown', { open: false, active: -1 }, 0)).toEqual({ kind: 'ignore' });
    expect(comboboxKey('ArrowUp', { open: true, active: -1 }, 0)).toEqual({ kind: 'ignore' });
  });

  it('Enter selects the active option', () => {
    expect(comboboxKey('Enter', { open: true, active: 1 }, 3)).toEqual({
      kind: 'select',
      index: 1,
    });
  });

  it('Enter without an active option is left to the input', () => {
    expect(comboboxKey('Enter', { open: true, active: -1 }, 3)).toEqual({ kind: 'ignore' });
    expect(comboboxKey('Enter', { open: false, active: 1 }, 3)).toEqual({ kind: 'ignore' });
  });

  it('Escape closes an open list', () => {
    expect(comboboxKey('Escape', { open: true, active: 0 }, 3)).toEqual({ kind: 'close' });
  });

  it('Escape on a closed list is not handled', () => {
    expect(comboboxKey('Escape', { open: false, active: -1 }, 3)).toEqual({ kind: 'ignore' });
  });
});
