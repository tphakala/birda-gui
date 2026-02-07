import { ipcMain } from 'electron';
import { listModels, listAvailable, installModel, modelInfo } from '../birda/models';

export function registerModelHandlers(): void {
  ipcMain.handle('birda:models-list', async () => {
    return listModels();
  });

  ipcMain.handle('birda:models-available', async () => {
    return listAvailable();
  });

  ipcMain.handle('birda:models-install', async (event, name: string) => {
    const sender = event.sender;
    return installModel(name, (line) => {
      if (!sender.isDestroyed()) {
        sender.send('birda:models-install-progress', line);
      }
    });
  });

  ipcMain.handle('birda:models-info', async (_event, name: string) => {
    return modelInfo(name);
  });
}
