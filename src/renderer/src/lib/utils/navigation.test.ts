import { describe, expect, it } from 'vitest';
import { completedRunNavigation, tabSwitch } from './navigation';

describe('tabSwitch', () => {
  it('stays on the active tab', () => {
    expect(tabSwitch('map', 'map', false)).toBe('stay');
    expect(tabSwitch('settings', 'settings', true)).toBe('stay');
  });

  it('switches from a tab without unsaved changes', () => {
    expect(tabSwitch('analysis', 'species', false)).toBe('switch');
    expect(tabSwitch('map', 'settings', true)).toBe('switch');
  });

  it('asks before leaving Settings with unsaved changes', () => {
    expect(tabSwitch('settings', 'detections', true)).toBe('confirm');
  });

  it('switches from Settings when nothing is unsaved', () => {
    expect(tabSwitch('settings', 'detections', false)).toBe('switch');
  });
});

describe('completedRunNavigation', () => {
  it('opens the new run from the Analysis tab', () => {
    expect(completedRunNavigation('analysis', null)).toEqual({ select: true, switchTab: true });
    expect(completedRunNavigation('analysis', 4)).toEqual({ select: true, switchTab: true });
  });

  it('selects the new run without switching from Map, Species or Settings', () => {
    for (const tab of ['map', 'species', 'settings'] as const) {
      expect(completedRunNavigation(tab, 4)).toEqual({ select: true, switchTab: false });
    }
  });

  it('keeps the Detections selection the user is looking at', () => {
    expect(completedRunNavigation('detections', 4)).toEqual({ select: false, switchTab: false });
  });

  it('selects the new run on Detections when nothing is selected', () => {
    expect(completedRunNavigation('detections', null)).toEqual({ select: true, switchTab: false });
  });
});
