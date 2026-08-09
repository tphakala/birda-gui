import { ipcMain } from 'electron';
import {
  listModels,
  listAvailable,
  installModel,
  modelInfo,
  removeModel,
  getManifest,
  cancelInstall,
} from '../birda/models';
import { registerCoverageUrls } from '../birda/coverageCache';
import { setDefaultModel } from '../birda/config';

// Model id/region/variant become birda CLI args; reject anything that is not a
// plain identifier (in particular a leading "-" that birda would read as a flag).
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

  ipcMain.handle(
    'birda:models-install',
    async (event, opts: { id: string; region?: string | undefined; variant?: string | undefined }) => {
      if (typeof opts.id !== 'string' || !SAFE_ID.test(opts.id)) {
        throw new Error('Invalid model install options');
      }
      for (const value of [opts.region, opts.variant]) {
        if (value !== undefined && (typeof value !== 'string' || !SAFE_ID.test(value))) {
          throw new Error('Invalid model install options');
        }
      }
      const sender = event.sender;
      return installModel(opts, (progress) => {
        if (!sender.isDestroyed()) {
          sender.send('birda:models-install-progress', progress);
        }
      });
    },
  );

  ipcMain.handle('birda:models-install-cancel', () => {
    return cancelInstall();
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
