import { ipcMain, BrowserWindow } from 'electron';
import { listModels, listAvailable, installModel, modelInfo } from '../birda/models';

export function registerModelHandlers(): void {
  ipcMain.handle('birda:models-list', async () => {
    return listModels();
  });

  ipcMain.handle('birda:models-available', async () => {
    return listAvailable();
  });

  ipcMain.handle('birda:models-install', async (_event, name: string) => {
    const win = BrowserWindow.getFocusedWindow();
    return installModel(name, (line) => {
      win?.webContents.send('birda:models-install-progress', line);
    });
  });

  ipcMain.handle('birda:models-info', async (_event, name: string) => {
    return modelInfo(name);
  });
}
