import { ipcMain } from 'electron';
import { listModels, listAvailable, installModel, modelInfo, removeModel, getManifest } from '../birda/models';
import { registerCoverageUrls } from '../birda/coverageCache';
import { setDefaultModel } from '../birda/config';

export function registerModelHandlers(): void {
  ipcMain.handle('birda:models-list', async () => {
    return listModels();
  });

  ipcMain.handle('birda:models-available', async () => {
    return listAvailable();
  });

  ipcMain.handle('birda:models-manifest', async (_event, id: string) => {
    const manifest = await getManifest(id);
    // Teach the birda-map:// protocol which coverage URLs are allowed to fetch.
    registerCoverageUrls(manifest.id, manifest.variants);
    return manifest;
  });

  ipcMain.handle('birda:models-install', async (event, opts: { id: string; region?: string; variant?: string }) => {
    const sender = event.sender;
    return installModel(opts, (progress) => {
      if (!sender.isDestroyed()) {
        sender.send('birda:models-install-progress', progress);
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
