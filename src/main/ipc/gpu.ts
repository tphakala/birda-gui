import { ipcMain } from 'electron';
import { detectGpuCapabilities } from '../gpu/detection';
import { settingsStore } from '../settings/store';

export function registerGpuHandlers(): void {
  ipcMain.handle('gpu:detect-capabilities', async () => {
    const settings = await settingsStore.get();
    const birdaPath = settings.birda_path.trim() || undefined;
    return await detectGpuCapabilities(birdaPath);
  });
}
