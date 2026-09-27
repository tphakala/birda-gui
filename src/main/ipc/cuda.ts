import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getCudaStatus, downloadCudaLibs, cancelDownload, removeCudaLibs, getCudaDownloadSize } from '../cuda/manager';
import type { CudaStatus, CudaDownloadResult } from '$shared/types';
import { sendToWindows } from './broadcast';

export function registerCudaHandlers(): void {
  ipcMain.handle('cuda:check-status', async (): Promise<CudaStatus> => {
    return getCudaStatus();
  });

  ipcMain.handle('cuda:get-download-size', async (_event: IpcMainInvokeEvent, version: string): Promise<number> => {
    return getCudaDownloadSize(version);
  });

  ipcMain.handle('cuda:download', async (_event: IpcMainInvokeEvent, version: string): Promise<CudaDownloadResult> => {
    // Every window, so one reopened mid-download can follow it (SettingsPanel rehydrates from cuda:check-status).
    return downloadCudaLibs(version, (downloaded, total, phase) => {
      sendToWindows('cuda:download-progress', {
        downloadedBytes: downloaded,
        totalBytes: total,
        phase,
      });
    });
  });

  ipcMain.handle('cuda:cancel-download', (): boolean => {
    return cancelDownload();
  });

  ipcMain.handle('cuda:remove', (): void => {
    removeCudaLibs();
  });
}
