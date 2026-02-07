import { ipcMain } from 'electron';
import { listModels, listAvailable, installModel, modelInfo } from '../birda/models';

export function registerModelHandlers(): void {
  ipcMain.handle('birda:models-list', async () => {
    return listModels();
  });

  ipcMain.handle('birda:models-available', async () => {
    return listAvailable();
  });

  ipcMain.handle('birda:models-install', async (_event, name: string) => {
    return installModel(name);
  });

  ipcMain.handle('birda:models-info', async (_event, name: string) => {
    return modelInfo(name);
  });
}
