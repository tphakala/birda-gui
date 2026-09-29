export type Tab = 'analysis' | 'detections' | 'map' | 'species' | 'settings';

/**
 * What a request to open a tab does: nothing when it is already open, a switch,
 * or a question first because leaving Settings would discard unsaved changes.
 */
export function tabSwitch(active: Tab, target: Tab, settingsUnsaved: boolean): 'stay' | 'switch' | 'confirm' {
  if (target === active) return 'stay';
  if (active === 'settings' && settingsUnsaved) return 'confirm';
  return 'switch';
}

/**
 * What to do with the window when an analysis ends with a run to show. Only a
 * user waiting on the Analysis tab is taken to the results; anywhere else the
 * window stays where it is (a Settings page may hold unsaved edits, a dialog may
 * be open). A run the user is already looking at on Detections is not replaced.
 */
export function completedRunNavigation(
  activeTab: Tab,
  selectedRunId: number | null,
): { select: boolean; switchTab: boolean } {
  switch (activeTab) {
    case 'analysis':
      return { select: true, switchTab: true };
    case 'detections':
      return { select: selectedRunId === null, switchTab: false };
    default:
      return { select: true, switchTab: false };
  }
}
