import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_INVOKE_CHANNELS = new Set([
  'app:get-settings',
  'app:set-settings',
  'app:check-birda',
  'app:get-log',
  'birda:analyze',
  'birda:cancel-analysis',
  'birda:config-show',
  'birda:config-path',
  'birda:models-list',
  'birda:models-available',
  'birda:models-install',
  'birda:models-info',
  'birda:extract-clip',
  'clip:save-spectrogram',
  'clip:get-spectrogram',
  'clip:export-region',
  'catalog:get-runs',
  'catalog:delete-run',
  'catalog:get-detections',
  'catalog:search-species',
  'catalog:get-species-summary',
  'catalog:species-locations',
  'catalog:location-species',
  'catalog:get-locations',
  'catalog:get-locations-with-counts',
  'catalog:stats',
  'catalog:clear-database',
  'labels:resolve-all',
  'labels:search-by-common-name',
  'labels:available-languages',
  'species:fetch',
  'species:save-list',
  'species:create-custom-list',
  'species:get-lists',
  'species:get-entries',
  'species:delete-list',
  'fs:open-file-dialog',
  'fs:open-executable-dialog',
  'fs:open-folder-dialog',
  'fs:read-coordinates',
  'fs:scan-source',
  'fs:open-in-explorer',
  'app:get-licenses',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'birda:analysis-progress',
  'birda:models-install-progress',
  'app:log',
  'menu:open-file',
  'menu:open-folder',
  'menu:switch-tab',
  'menu:focus-search',
  'menu:toggle-log',
  'menu:setup-wizard',
  'menu:show-licenses',
]);

contextBridge.exposeInMainWorld('birda', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      throw new Error(`IPC receive channel not allowed: ${channel}`);
    }
    ipcRenderer.on(channel, (_event, ...args: unknown[]) => {
      callback(...args);
    });
  },
  removeAllListeners: (channel: string) => {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      throw new Error(`IPC receive channel not allowed: ${channel}`);
    }
    ipcRenderer.removeAllListeners(channel);
  },
});
