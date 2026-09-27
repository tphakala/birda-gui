import { BrowserWindow } from 'electron';

/**
 * Sends to every open window rather than to the one that started an
 * operation, so a reloaded or reopened window still receives its events.
 */
export function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
