import { ipcMain } from 'electron';
import { detectGpuCapabilities } from '../gpu/detection';
import { loadSettings } from '../settings/loader';

export function registerGpuHandlers(): void {
  ipcMain.handle('gpu:detect-capabilities', async () => {
    const settings = await loadSettings();
    const birdaPath = settings.birda_path.trim() || undefined;
    return await detectGpuCapabilities(birdaPath);
  });
}
