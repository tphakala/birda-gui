import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  getCudaStatus,
  downloadCudaLibs,
  cancelDownload,
  removeCudaLibs,
  getCudaDownloadSize,
  CudaDownloadBusyError,
  CudaDownloadCancelledError,
} from '../cuda/manager';
import type { CudaStatus, CudaDownloadResult, CudaDownloadFinished } from '$shared/types';
import { sendToWindows } from './broadcast';

export function registerCudaHandlers(): void {
  ipcMain.handle('cuda:check-status', async (): Promise<CudaStatus> => {
    return getCudaStatus();
  });

  ipcMain.handle('cuda:get-download-size', async (_event: IpcMainInvokeEvent, version: string): Promise<number> => {
    return getCudaDownloadSize(version);
  });

  ipcMain.handle('cuda:download', async (_event: IpcMainInvokeEvent, version: string): Promise<CudaDownloadResult> => {
    // Progress and the outcome go to every window, so one reloaded or reopened
    // mid-download can follow it (SettingsPanel rehydrates from cuda:check-status).
    const finished = (outcome: CudaDownloadFinished['outcome'], error?: string) => {
      sendToWindows('cuda:download-finished', { outcome, error } satisfies CudaDownloadFinished);
    };
    try {
      const result = await downloadCudaLibs(version, (downloaded, total, phase) => {
        sendToWindows('cuda:download-progress', {
          downloadedBytes: downloaded,
          totalBytes: total,
          phase,
        });
      });
      finished('installed');
      return result;
    } catch (err) {
      // A request refused because a download is running never started, so it has no outcome to report.
      if (!(err instanceof CudaDownloadBusyError)) {
        finished(err instanceof CudaDownloadCancelledError ? 'cancelled' : 'failed', (err as Error).message);
      }
      throw err;
    }
  });

  ipcMain.handle('cuda:cancel-download', (): boolean => {
    return cancelDownload();
  });

  ipcMain.handle('cuda:remove', (): void => {
    removeCudaLibs();
  });
}
