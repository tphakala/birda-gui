import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  dialog as electronDialog,
  protocol,
  session,
  shell,
} from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { registerHandlers } from './ipc/handlers';
import { closeDbForShutdown, getDb } from './db/database';
import { markStaleRunsAsFailed } from './db/runs';
import { buildLabelsPath, reloadLabels } from './labels/label-service';
import { listModels } from './birda/models';
import { killAll as killAllBirdaProcesses } from './birda/runner';
import { stopAnalysisForQuit } from './ipc/analysis';
import { settingsStore } from './settings/store';
import { logFilePath, startMainLog } from './main-log';
import { registerBirdaMapProtocol, registerBirdaMediaProtocol } from './media-protocol';
import { reportCatalogOpenFailure } from './startup-dialog';
import { applyPermissionPolicy, hardenWebContents } from './window-security';

// Must be called before app.whenReady(); tells Chromium the scheme supports fetch().
// secure + corsEnabled are required for cross-origin fetch from the dev server origin
// (http://localhost:5173) on Electron >= 41.4, where Chromium tightened custom-scheme CORS.
protocol.registerSchemesAsPrivileged([
  { scheme: 'birda-media', privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'birda-map', privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// The page the main window loads: the dev server, or the packaged index.html.
// window-security treats only this page as the app.
const APP_URL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(APP_URL);
}

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-file'),
        },
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:open-folder'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Analysis',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:switch-tab', 'analysis'),
        },
        {
          label: 'Detections',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:switch-tab', 'detections'),
        },
        {
          label: 'Map',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('menu:switch-tab', 'map'),
        },
        {
          label: 'Species',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('menu:switch-tab', 'species'),
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow?.webContents.send('menu:switch-tab', 'settings'),
        },
        { type: 'separator' },
        {
          label: 'Search Species',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:focus-search'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Log Panel',
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow?.webContents.send('menu:toggle-log'),
        },
        // Reload and DevTools are for development; a packaged build has neither.
        ...(app.isPackaged
          ? []
          : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Setup Wizard...',
          click: () => mainWindow?.webContents.send('menu:setup-wizard'),
        },
        { type: 'separator' },
        {
          label: 'Third Party Licenses',
          click: () => mainWindow?.webContents.send('menu:show-licenses'),
        },
        {
          label: 'Show Log File',
          click: () => {
            shell.showItemInFolder(logFilePath());
          },
        },
        { type: 'separator' },
        {
          label: 'About Birda GUI',
          click: () => {
            void electronDialog.showMessageBox({
              type: 'info',
              title: 'About Birda GUI',
              message: `Birda GUI v${app.getVersion()}`,
              detail: 'Desktop GUI for the birda bird species detection CLI.\nhttps://github.com/tphakala/birda',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// One instance per user: a second one would share the catalog and finish the
// first instance's running analysis as stale at its startup.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  startMainLog();
  // Every window, including ones opened by a page, gets the navigation policy.
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, APP_URL);
  });
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    if (!mainWindow) {
      // macOS keeps the app running with no window open.
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

void app.whenReady().then(async () => {
  // A second instance quits without touching the catalog.
  if (!hasInstanceLock) return;
  applyPermissionPolicy(session.defaultSession, APP_URL);

  registerBirdaMediaProtocol();
  registerBirdaMapProtocol();
  await registerHandlers();

  // Open the catalog before anything uses it: a catalog that cannot be opened or
  // upgraded otherwise rejects this callback and the app runs with no window.
  try {
    getDb();
  } catch (err) {
    console.error('[catalog] Failed to open the catalog:', err);
    reportCatalogOpenFailure(err);
    return;
  }

  // Mark any runs stuck in 'running' from a previous session as failed. This is
  // housekeeping: a catalog that opens but cannot be written (read-only file, or
  // locked by another process) still gets a window, and its reads keep working.
  try {
    const staleCount = markStaleRunsAsFailed();
    if (staleCount > 0) {
      console.log(`[startup] Marked ${staleCount} stale running run(s) as failed`);
    }
  } catch (err) {
    console.error('[startup] Failed to mark stale runs as failed:', err);
  }

  // Initialize label service from default model's labels with saved language preference
  try {
    const models = await listModels();
    const defaultModel = models.find((m) => m.is_default) ?? models[0];
    if (defaultModel.labels_path) {
      const language = (await settingsStore.get()).species_language || 'en';
      const labelsPath = buildLabelsPath(defaultModel.labels_path, language);
      await reloadLabels(labelsPath);
    }
  } catch (err) {
    console.error('[labels] Failed to load label data:', err);
  }

  createMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function shutdown(): void {
  stopAnalysisForQuit();
  killAllBirdaProcesses();
}

app.on('before-quit', () => {
  shutdown();
});

app.on('will-quit', () => {
  shutdown();
  closeDbForShutdown();
});

process.on('SIGINT', () => {
  shutdown();
  closeDbForShutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  closeDbForShutdown();
  process.exit(0);
});
