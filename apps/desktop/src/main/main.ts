import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { spawnNextServer, terminateNextServer, log } from './next-server.js';
import { createWindow } from './window.js';
import { createWindowActions, createApplicationMenu, registerGlobalShortcuts } from './menus.js';
import { createTray } from './tray.js';
import { connection } from './connection.js';
import { updater } from './auto-updater.js';
import { isOriginAllowlisted } from '../shared/links.js';
import pkg from '../../package.json' with { type: 'json' };

const APP_VERSION = (pkg as { version: string }).version;

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function wireIpc(): void {
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // App
  ipcMain.handle('app:getVersion', () => APP_VERSION);
  ipcMain.handle('app:restart', () => { app.relaunch(); app.quit(); });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:openExternally', async (_event, url: string) => {
    if (!isOriginAllowlisted(url)) return false;
    return shell.openExternal(url).then(() => true).catch(() => false);
  });

  // Updater
  ipcMain.handle('updater:check', () => { updater.check(); return true; });
}

function wireConnection(): void {
  if (!mainWindow) return;
  const win = mainWindow;
  connection.onOnline(() => win.webContents.send('connection:online'));
  connection.onOffline(() => win.webContents.send('connection:offline'));
  if (connection.online) win.webContents.send('connection:online');
}

function wireUpdater(): void {
  updater.on('update-available', () => mainWindow?.webContents.send('updater:update-available'));
  updater.on('update-downloaded', () => mainWindow?.webContents.send('updater:update-downloaded'));
  updater.on('update-not-available', () => mainWindow?.webContents.send('updater:update-not-available'));
  updater.on('error', (msg) => mainWindow?.webContents.send('updater:error', msg));
}

// Catch unhandled errors in the main process and log them.
process.on('uncaughtException', (err) => {
  log('ERROR', 'uncaughtException:', err.stack ?? err.message);
});
process.on('unhandledRejection', (reason) => {
  log('ERROR', 'unhandledRejection:', String(reason));
});

export function createApplication(): void {
  log('INFO', 'AlgoVault', APP_VERSION, '— packaged:', app.isPackaged);
  log('INFO', 'appPath:', app.getAppPath());

  // Start the Next.js server as early as possible so it can initialise
  // while Electron loads the rest of the main process.
  spawnNextServer();

  app.on('window-all-closed', () => {
    // On macOS the app stays alive in the dock.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    terminateNextServer();
  });

  app.whenReady().then(async () => {
    log('INFO', 'app ready');

    mainWindow = createWindow();

    const actions = createWindowActions(() => mainWindow);
    createApplicationMenu(actions);
    registerGlobalShortcuts(actions);
    wireIpc();
    wireConnection();
    wireUpdater();

    const tray = createTray();
    log('INFO', 'tray created:', Boolean(tray));
  });

  // macOS: re-create window when dock icon is clicked with no windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      const actions = createWindowActions(() => mainWindow);
      createApplicationMenu(actions);
      wireIpc();
      wireConnection();
      wireUpdater();
    }
  });
}

createApplication();
