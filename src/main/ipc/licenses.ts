import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';

export function registerLicenseHandlers(): void {
  ipcMain.handle('app:get-licenses', async () => {
    const licensePath = app.isPackaged
      ? path.join(process.resourcesPath, 'THIRD_PARTY_LICENSES.txt')
      : path.join(app.getAppPath(), 'THIRD_PARTY_LICENSES.txt');

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return await fs.promises.readFile(licensePath, 'utf-8');
    } catch {
      return null;
    }
  });
}
