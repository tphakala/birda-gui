import { ipcMain } from 'electron';
import { detectGpuCapabilities } from '../gpu/detection';
import { findBirda } from '../birda/runner';

export function registerGpuHandlers(): void {
  ipcMain.handle('gpu:detect-capabilities', async () => {
    // Ask the same birda that analyses use: configured, bundled or on PATH
    const birdaPath = await findBirda().catch(() => undefined);
    return await detectGpuCapabilities(birdaPath);
  });
}
