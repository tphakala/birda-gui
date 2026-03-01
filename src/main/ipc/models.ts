import { ipcMain } from 'electron';
import { listModels, listAvailable, installModel, modelInfo, removeModel } from '../birda/models';
import { setDefaultModel } from '../birda/config';

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

  ipcMain.handle('birda:models-set-default', async (_event, modelId: string) => {
    return setDefaultModel(modelId);
  });

  ipcMain.handle('birda:models-remove', async (_event, modelId: string) => {
    return removeModel(modelId);
  });
}
