import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { spawnNextServer, terminateNextServer } from './next-server';
import { createWindow } from './window';
import { createWindowActions, createApplicationMenu, registerGlobalShortcuts } from './menus';
import { createTray } from './tray';
import { connection } from './connection';
import { updater } from './auto-updater';
import { isOriginAllowlisted } from '../shared/links';
import pkg from '../package.json';

const APP_NAME = (pkg as { name: string }).name;
const APP_VERSION = (pkg as { version: string }).version;

let mainWindow: BrowserWindow | null = null;

/** Thin, single source of truth for window actions. */
function getWindowActions(): ReturnType<typeof createWindowActions> {
  if (!mainWindow) mainWindow = createWindow();
  return createWindowActions();
}

function wireIpc(): void {
  const actions = getWindowActions();

  ipcMain.handle('window:minimize', () => actions.minimize());
  ipcMain.handle('window:maximize', () => actions.maximize());
  ipcMain.handle('window:close', () => actions.close());
  ipcMain.handle('window:isMaximized', () => actions.isMaximized());

  ipcMain.handle('app:getVersion', () => APP_VERSION);
  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.quit();
  });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:openExternally', async (_event, url: string) => {
    if (!isOriginAllowlisted(url)) {
      // Blocked origins fail locally and harmlessly — no error is thrown to the
      // renderer and nothing leaks.
      return false;
    }
    return shell.openExternal(url).then(() => true).catch(() => false);
  });

  ipcMain.handle('updater:check', () => {
    updater.check();
    return true;
  });
}

function wireConnection(): void {
  if (mainWindow) {
    connection.onOnline(() => mainWindow.webContents.send('connection:online'));
    connection.onOffline(() => mainWindow.webContents.send('connection:offline'));
  }
  // Reflect the current OS network state on first load.
  if (connection.online) {
    mainWindow?.webContents.send('connection:online');
  }
}

function wireUpdater(): void {
  updater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('updater:update-available');
  });
  updater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('updater:update-downloaded');
  });
  updater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('updater:update-not-available');
  });
  updater.on('error', (message) => {
    if (mainWindow) mainWindow.webContents.send('updater:error', message);
  });
}

export function createApplication(): void {
  spawnNextServer();

  if (process.env.ALGOVAULT_DEV) {
    console.log('[desktop] ALGOVAULT_DEV set; tray and menus wired on ready');
  }

  const actions = getWindowActions();

  app.on('activate', () => {
    // macOS keeps the dock icon alive and re-creates a window when the icon is
    // clicked again (activation). Windows/Linux quit when the last window closes.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      if (!mainWindow) return;
      createApplicationMenu(actions);
      wireIpc();
      wireConnection();
      wireUpdater();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    terminateNextServer();
  });

  app.whenReady().then(async () => {
    createWindow();
    if (!mainWindow) return;
    createApplicationMenu(actions);
    registerGlobalShortcuts(actions);
    wireIpc();
    wireConnection();
    wireUpdater();

    // Build the tray now that the app is ready; the icon is expected at
    // apps/desktop/public/icons/algovault-logo-32.png.
    const tray = createTray();
    if (process.env.ALGOVAULT_DEV) {
      console.log('[desktop] tray ready:', Boolean(tray));
    }
  });
}
