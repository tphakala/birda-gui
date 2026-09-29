import { appState, requestTab, type Tab } from '$lib/stores/app.svelte';
import { openFileDialog, openFolderDialog } from '$lib/utils/ipc';

const VALID_TABS = new Set<Tab>(['analysis', 'detections', 'map', 'species', 'settings']);

export function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && VALID_TABS.has(value as Tab);
}

export function setupMenuListeners(callbacks: {
  /** Whether a source may be opened now; called before the dialog opens. */
  canOpenFile: () => boolean;
  onOpenFile: (path: string) => void;
  onFocusSearch: () => void;
}): () => void {
  const handleOpenFile = () => {
    if (!callbacks.canOpenFile()) return;
    void (async () => {
      const path = await openFileDialog();
      if (path) callbacks.onOpenFile(path);
    })();
  };

  const handleOpenFolder = () => {
    if (!callbacks.canOpenFile()) return;
    void (async () => {
      const path = await openFolderDialog();
      if (path) callbacks.onOpenFile(path);
    })();
  };

  const handleSwitchTab = (...args: unknown[]) => {
    const tab = args[0];
    if (!isTab(tab)) return;
    requestTab(tab);
  };

  const handleFocusSearch = () => {
    callbacks.onFocusSearch();
  };

  const handleToggleLog = () => {
    appState.showLogPanel = !appState.showLogPanel;
  };

  const unsubscribes = [
    window.birda.on('menu:open-file', handleOpenFile),
    window.birda.on('menu:open-folder', handleOpenFolder),
    window.birda.on('menu:switch-tab', handleSwitchTab),
    window.birda.on('menu:focus-search', handleFocusSearch),
    window.birda.on('menu:toggle-log', handleToggleLog),
  ];

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
