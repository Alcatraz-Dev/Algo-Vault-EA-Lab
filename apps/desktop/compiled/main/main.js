import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Notification, } from 'electron';
import { spawnNextServer, terminateNextServer, log } from './next-server.js';
import { createWindow } from './window.js';
import { createApplicationMenu } from './menus.js';
import { createTray } from './tray.js';
import { connection } from './connection.js';
import { updater } from './auto-updater.js';
import { isOriginAllowlisted } from '../shared/links.js';
import pkg from '../../package.json' with { type: 'json' };
const APP_VERSION = pkg.version;
let mainWindow = null;
let ipcWired = false;
export function getMainWindow() {
    return mainWindow;
}
function wireIpc() {
    if (ipcWired)
        return;
    ipcWired = true;
    // Window controls
    ipcMain.handle('window:minimize', () => mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => {
        if (!mainWindow)
            return;
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });
    ipcMain.handle('window:close', () => mainWindow?.close());
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
    ipcMain.handle('window:isFullScreen', () => mainWindow?.isFullScreen() ?? false);
    // App
    ipcMain.handle('app:getVersion', () => APP_VERSION);
    ipcMain.handle('app:restart', () => {
        app.relaunch();
        app.quit();
    });
    ipcMain.handle('app:quit', () => app.quit());
    ipcMain.handle('app:openExternally', async (_event, url) => {
        if (!isOriginAllowlisted(url))
            return false;
        return shell
            .openExternal(url)
            .then(() => true)
            .catch(() => false);
    });
    // Native Dialogs
    ipcMain.handle('dialog:showSaveDialog', async (_event, options) => {
        if (!mainWindow)
            return { canceled: true };
        return dialog.showSaveDialog(mainWindow, {
            title: options?.title ?? 'Save File',
            defaultPath: options?.defaultPath,
            filters: options?.filters ?? [],
        });
    });
    ipcMain.handle('dialog:showOpenDialog', async (_event, options) => {
        if (!mainWindow)
            return { canceled: true, filePaths: [] };
        return dialog.showOpenDialog(mainWindow, {
            title: options?.title ?? 'Select File',
            properties: options?.properties ?? ['openFile'],
            filters: options?.filters ?? [],
        });
    });
    ipcMain.handle('dialog:confirm', async (_event, options) => {
        if (!mainWindow)
            return false;
        const res = await dialog.showMessageBox(mainWindow, {
            type: options?.type ?? 'question',
            buttons: ['Cancel', 'Confirm'],
            defaultId: 1,
            cancelId: 0,
            title: options?.title ?? 'Confirm Action',
            message: options?.message ?? 'Are you sure?',
            detail: options?.detail ?? '',
        });
        return res.response === 1;
    });
    ipcMain.handle('dialog:alert', async (_event, options) => {
        if (!mainWindow)
            return;
        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['OK'],
            title: options?.title ?? 'AlgoVault',
            message: options?.message ?? '',
            detail: options?.detail ?? '',
        });
    });
    // Native Clipboard
    ipcMain.handle('clipboard:writeText', (_event, text) => {
        if (typeof text === 'string')
            clipboard.writeText(text);
    });
    ipcMain.handle('clipboard:readText', () => clipboard.readText());
    // Native Notifications
    ipcMain.handle('notification:show', (_event, options) => {
        if (Notification.isSupported()) {
            new Notification({
                title: options?.title ?? 'AlgoVault',
                body: options?.body ?? '',
            }).show();
            return true;
        }
        return false;
    });
    // Feed Connection status
    ipcMain.handle('connection:getStatus', () => ({
        online: connection.online,
    }));
    // Updater
    ipcMain.handle('updater:check', () => {
        updater.check();
        return true;
    });
}
function wireConnection() {
    if (!mainWindow)
        return;
    const win = mainWindow;
    connection.onOnline(() => {
        if (!win.isDestroyed())
            win.webContents.send('connection:online');
    });
    connection.onOffline(() => {
        if (!win.isDestroyed())
            win.webContents.send('connection:offline');
    });
    if (connection.online) {
        if (!win.isDestroyed())
            win.webContents.send('connection:online');
    }
}
function wireUpdater() {
    if (!mainWindow)
        return;
    const win = mainWindow;
    updater.on('update-available', () => {
        if (!win.isDestroyed())
            win.webContents.send('updater:update-available');
    });
    updater.on('update-downloaded', () => {
        if (!win.isDestroyed())
            win.webContents.send('updater:update-downloaded');
    });
    updater.on('update-not-available', () => {
        if (!win.isDestroyed())
            win.webContents.send('updater:update-not-available');
    });
    updater.on('error', (msg) => {
        if (!win.isDestroyed())
            win.webContents.send('updater:error', msg);
    });
}
// Catch unhandled errors in the main process and log them safely.
process.on('uncaughtException', (err) => {
    log('ERROR', 'uncaughtException:', err.stack ?? err.message);
});
process.on('unhandledRejection', (reason) => {
    log('ERROR', 'unhandledRejection:', String(reason));
});
export function createApplication() {
    log('INFO', 'AlgoVault', APP_VERSION, '— packaged:', app.isPackaged);
    log('INFO', 'appPath:', app.getAppPath());
    // Start the Next.js server as early as possible so it can initialise
    // while Electron loads the rest of the main process.
    spawnNextServer();
    app.on('window-all-closed', () => {
        // On macOS the app stays alive in the dock until explicitly quit.
        if (process.platform !== 'darwin')
            app.quit();
    });
    app.on('will-quit', () => {
        terminateNextServer();
    });
    app.whenReady().then(async () => {
        log('INFO', 'app ready');
        mainWindow = createWindow();
        createApplicationMenu(() => mainWindow);
        wireIpc();
        wireConnection();
        wireUpdater();
        const tray = createTray();
        log('INFO', 'tray created:', Boolean(tray));
    });
    // macOS: re-create or focus window when dock icon is clicked.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
            createApplicationMenu(() => mainWindow);
            wireConnection();
            wireUpdater();
        }
        else if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
createApplication();
