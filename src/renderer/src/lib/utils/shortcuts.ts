import { appState, type Tab } from '$lib/stores/app.svelte';
import { openFileDialog, openFolderDialog } from '$lib/utils/ipc';

export function setupMenuListeners(callbacks: {
  onOpenFile: (path: string) => void;
  onFocusSearch: () => void;
}): () => void {
  const handleOpenFile = () => {
    void (async () => {
      const path = await openFileDialog();
      if (path) callbacks.onOpenFile(path);
    })();
  };

  const handleOpenFolder = () => {
    void (async () => {
      const path = await openFolderDialog();
      if (path) callbacks.onOpenFile(path);
    })();
  };

  const VALID_TABS = new Set<string>(['analysis', 'detections', 'map', 'species', 'settings']);

  const handleSwitchTab = (...args: unknown[]) => {
    const tab = args[0] as string;
    if (VALID_TABS.has(tab)) {
      appState.activeTab = tab as Tab;
    }
  };

  const handleFocusSearch = () => {
    callbacks.onFocusSearch();
  };

  const handleToggleLog = () => {
    appState.showLogPanel = !appState.showLogPanel;
  };

  window.birda.on('menu:open-file', handleOpenFile);
  window.birda.on('menu:open-folder', handleOpenFolder);
  window.birda.on('menu:switch-tab', handleSwitchTab);
  window.birda.on('menu:focus-search', handleFocusSearch);
  window.birda.on('menu:toggle-log', handleToggleLog);

  return () => {
    window.birda.removeAllListeners('menu:open-file');
    window.birda.removeAllListeners('menu:open-folder');
    window.birda.removeAllListeners('menu:switch-tab');
    window.birda.removeAllListeners('menu:focus-search');
    window.birda.removeAllListeners('menu:toggle-log');
  };
}
