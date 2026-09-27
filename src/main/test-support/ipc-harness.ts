import os from 'node:os';
import path from 'node:path';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** A userData directory that does not exist, so nothing a test reaches can create a real catalog. */
export const NO_USER_DATA = path.join(os.tmpdir(), 'birda-gui-test-no-such-dir', 'userData');

/**
 * State behind the Electron mock: registered IPC handlers, and every message
 * sent to a window. Tests set windows to change which windows exist.
 */
export const ipc = {
  handlers: new Map<string, Handler>(),
  sent: [] as { window: number; channel: string; payload: unknown }[],
  windows: [{ destroyed: false }] as { destroyed: boolean }[],
};

/** The electron module for vi.mock('electron', ...). */
export const electronMock = {
  ipcMain: {
    handle: (channel: string, fn: Handler) => ipc.handlers.set(channel, fn),
  },
  BrowserWindow: {
    getAllWindows: () =>
      ipc.windows.map((w, i) => ({
        isDestroyed: () => w.destroyed,
        webContents: {
          send: (channel: string, payload: unknown) => ipc.sent.push({ window: i, channel, payload }),
        },
      })),
  },
  dialog: {},
  app: { getPath: () => NO_USER_DATA },
};

export function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = ipc.handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

/** Payloads sent on a channel to the first window, in order. */
export function sentOn(channel: string): unknown[] {
  return ipc.sent.filter((s) => s.channel === channel && s.window === 0).map((s) => s.payload);
}

export function resetIpc(): void {
  ipc.sent = [];
  ipc.windows = [{ destroyed: false }];
}
