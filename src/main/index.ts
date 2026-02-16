import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  dialog as electronDialog,
  net,
  protocol,
  session,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { registerHandlers } from './ipc/handlers';
import { closeDb } from './db/database';
import { markStaleRunsAsFailed } from './db/runs';
import { buildLabelsPath, reloadLabels } from './labels/label-service';
import { listModels } from './birda/models';
import { killAll as killAllBirdaProcesses } from './birda/runner';

// Must be called before app.whenReady() — tells Chromium the scheme supports fetch()
protocol.registerSchemesAsPrivileged([{ scheme: 'birda-media', privileges: { supportFetchAPI: true, stream: true } }]);

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
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
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
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
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

function registerBirdaMediaProtocol() {
  protocol.handle('birda-media', async (request) => {
    // birda-media:///D:/clips/file.wav → serve the local file
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    // On Windows, pathname starts with /D:/... — strip the leading slash before drive letter
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    // Security: only allow audio file extensions
    const ext = path.extname(filePath).toLowerCase();
    const allowedExts = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.png']);
    if (!allowedExts.has(ext)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return new Response('Not Found', { status: 404 });
    }

    return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`);
  });
}

void app.whenReady().then(async () => {
  // Security: allow permissions the app needs, deny everything else
  const ALLOWED_PERMISSIONS = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'fileSystem',
    'fullscreen',
    'media',
    'speaker-selection',
  ]);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  registerBirdaMediaProtocol();
  await registerHandlers();

  // Mark any runs stuck in 'running' from a previous session as failed
  const staleCount = markStaleRunsAsFailed();
  if (staleCount > 0) {
    console.log(`[startup] Marked ${staleCount} stale running run(s) as failed`);
  }

  // Initialize label service from default model's labels with saved language preference
  try {
    const models = await listModels();
    const defaultModel = models.find((m) => m.is_default) ?? models[0];
    if (defaultModel.labels_path) {
      // Read saved language preference
      let language = 'en';
      try {
        const settingsRaw = await fs.promises.readFile(
          path.join(app.getPath('userData'), 'birda-gui-settings.json'),
          'utf-8',
        );
        const saved = JSON.parse(settingsRaw) as Partial<{ species_language: string }>;
        if (saved.species_language) language = saved.species_language;
      } catch {
        // No settings file yet, use default
      }
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

app.on('before-quit', () => {
  killAllBirdaProcesses();
});

app.on('will-quit', () => {
  killAllBirdaProcesses();
  closeDb();
});

process.on('SIGINT', () => {
  killAllBirdaProcesses();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killAllBirdaProcesses();
  closeDb();
  process.exit(0);
});
