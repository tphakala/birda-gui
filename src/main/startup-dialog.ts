import { app, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDbPath } from './db/database';
import { logFilePath } from './main-log';

/**
 * Tells the user the catalog could not be opened or upgraded and exits. The
 * dialog offers the database in the file manager, so a damaged file can be
 * moved, and comes back after each look until the user chooses Quit.
 */
export function reportCatalogOpenFailure(err: unknown): void {
  const dbPath = getDbPath();
  const detail =
    'The database could not be opened or upgraded, so Birda GUI will close.\n\n' +
    'Make sure no other copy of Birda GUI is running and that the database file and its folder can be written, then start Birda GUI again. ' +
    'If the file is damaged, move it and any .db-wal and .db-shm files next to it to another folder; Birda GUI then starts with a new, empty database. ' +
    'Please report the problem with the details below at https://github.com/tphakala/birda-gui/issues\n\n' +
    `Database file: ${dbPath}\n` +
    `Log file: ${logFilePath()}\n` +
    `Error: ${err instanceof Error ? err.message : String(err)}`;

  let answer = 0;
  while (answer === 0) {
    answer = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Cannot open the Birda database',
      message: 'Cannot open the Birda database',
      detail,
      buttons: ['Show in Folder', 'Quit'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (answer === 0) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (fs.existsSync(dbPath)) shell.showItemInFolder(dbPath);
      else void shell.openPath(path.dirname(dbPath));
    }
  }
  app.exit(1);
}
