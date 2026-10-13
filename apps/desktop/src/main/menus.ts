import { app, BrowserWindow, Menu, globalShortcut, MenuItemConstructorOptions } from 'electron';
import pkg from '../package.json';

const APP_NAME = (pkg as { name: string }).name;
const APP_VERSION = (pkg as { version: string }).version;

/** Show the native "About" dialog. */
function showAbout(): void {
  const win = BrowserWindow.getFocusedWindow();
  const dialog = require('electron').dialog;
  dialog.showMessageBox(win ?? null, {
    type: 'info',
    title: `About ${APP_NAME}`,
    message: `${APP_NAME} v${APP_VERSION}`,
    detail:
      'Desktop shell for AlgoVault: window chrome, native menus, tray, auto-updater and feed-connection overlay on top of the existing production Next.js web app.',
    buttons: ['OK'],
  });
}

export interface WindowActions {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => boolean;
}

/**
 * Build a thin, single source of truth for window actions. The menus and the
 * connection/updater IPC handlers read from this object so every caller looks
 * at the same window and never creates a second BrowserWindow.
 */
export function createWindowActions(): WindowActions {
  let mainWindow: BrowserWindow | null = null;

  const actions: WindowActions = {
    minimize: () => {
      if (mainWindow) mainWindow.minimize();
    },
    maximize: () => {
      if (!mainWindow) return;
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    },
    close: () => {
      if (mainWindow) mainWindow.close();
    },
    isMaximized: () => mainWindow?.isMaximized() ?? false,
  };
}

export function createApplicationMenu(actions: WindowActions): void {
  const menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', role: 'redo' },
        { type: 'separator' },
        {
          label: 'Restart',
          accelerator: 'CommandOrControl+R',
          click: () => {
            app.relaunch();
            app.quit();
          },
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CommandOrControl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CommandOrControl+M', role: 'minimize' },
        { label: 'Maximize', accelerator: 'CommandOrControl+Return', role: 'zoom' },
        { type: 'separator' },
        { label: 'Frontmost', role: 'front' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CommandOrControl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CommandOrControl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CommandOrControl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CommandOrControl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.reload(),
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CommandOrControl+I',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About AlgoVault', click: showAbout },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

export function registerGlobalShortcuts(actions: WindowActions): void {
  const performClose = () => BrowserWindow.getFocusedWindow()?.close();
  const performReload = () => BrowserWindow.getFocusedWindow()?.webContents.reload();
  const performToggleFullscreen = () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  };

  globalShortcut.register('CommandOrControl+R', performReload);
  globalShortcut.register('CommandOrControl+W', performClose);
  globalShortcut.register('CommandOrControl+Shift+F', performToggleFullscreen);
  // `Cmd+,` is reserved for the (future) settings panel.
  globalShortcut.register('CommandOrControl+,', () => {
    // no-op — settings panel not implemented yet.
  });
}
