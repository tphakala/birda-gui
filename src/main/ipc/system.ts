import { ipcMain, app } from 'electron';

/**
 * Register IPC handlers for system-level operations.
 */
export function registerSystemHandlers(): void {
  /**
   * Get the system locale (e.g., 'en-US', 'fi-FI', 'sv-SE', 'de-DE', 'es-ES').
   * Used for auto-detecting the user's preferred UI language on first run.
   */
  ipcMain.handle('system:get-locale', () => {
    return app.getLocale();
  });

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });
}
