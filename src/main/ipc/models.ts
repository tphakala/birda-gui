import { ipcMain } from 'electron';
import {
  listModels,
  listAvailable,
  installModel,
  modelInfo,
  removeModel,
  getManifest,
  cancelInstall,
  getInstallStatus,
  ModelInstallBusyError,
  ModelInstallCancelledError,
} from '../birda/models';
import { registerCoverageUrls } from '../birda/coverageCache';
import { sendToWindows } from './broadcast';
import type { ModelInstallFinished, ModelInstallRequest } from '$shared/types';
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

  ipcMain.handle('birda:models-install', async (_event, opts: ModelInstallRequest) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- renderer input is untrusted
    if (typeof opts !== 'object' || opts === null || typeof opts.id !== 'string' || !SAFE_ID.test(opts.id)) {
      throw new Error('Invalid model install options');
    }
    for (const value of [opts.region, opts.variant]) {
      if (value !== undefined && (typeof value !== 'string' || !SAFE_ID.test(value))) {
        throw new Error('Invalid model install options');
      }
    }
    const request: ModelInstallRequest = { id: opts.id, region: opts.region, variant: opts.variant };
    // Progress and the outcome go to every window, so one reloaded mid-install can follow and finish it.
    const finished = (outcome: ModelInstallFinished['outcome'], error?: string) => {
      sendToWindows('birda:models-install-finished', { request, outcome, error } satisfies ModelInstallFinished);
    };
    try {
      const result = await installModel(request, (progress) => {
        sendToWindows('birda:models-install-progress', progress);
      });
      finished('installed');
      return result;
    } catch (err) {
      // A request refused because another install is running never started, so it has no outcome to report.
      if (!(err instanceof ModelInstallBusyError)) {
        finished(err instanceof ModelInstallCancelledError ? 'cancelled' : 'failed', (err as Error).message);
      }
      throw err;
    }
  });

  ipcMain.handle('birda:models-install-status', () => getInstallStatus());

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
