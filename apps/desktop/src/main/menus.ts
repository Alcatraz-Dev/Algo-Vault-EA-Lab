import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';
import pkg from '../../package.json' with { type: 'json' };

const APP_NAME = 'AlgoVault';
const APP_VERSION = (pkg as { version: string }).version;

export interface WindowActions {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => boolean;
}

export function createWindowActions(
  getWindow: () => BrowserWindow | null,
): WindowActions {
  return {
    minimize: () => {
      getWindow()?.minimize();
    },
    maximize: () => {
      const win = getWindow();
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    },
    close: () => {
      getWindow()?.close();
    },
    isMaximized: () => getWindow()?.isMaximized() ?? false,
  };
}

export function createApplicationMenu(
  actionsOrGetter: WindowActions | (() => BrowserWindow | null),
): void {
  const isMac = process.platform === 'darwin';

  const getTargetWindow = (): BrowserWindow | null => {
    if (typeof actionsOrGetter === 'function') {
      return actionsOrGetter();
    }
    return BrowserWindow.getFocusedWindow();
  };

  const sendNavigation = (route: string) => {
    const win = getTargetWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('navigation:go', route);
    }
  };

  const showAbout = () => {
    const win = getTargetWindow();
    const { dialog } = require('electron');
    dialog.showMessageBox(win ?? null, {
      type: 'info',
      title: `About ${APP_NAME}`,
      message: `${APP_NAME} v${APP_VERSION}`,
      detail:
        'Institutional AI-Powered Trading Platform & Quantitative Strategy Terminal for macOS.',
      buttons: ['OK'],
    });
  };

  const template: MenuItemConstructorOptions[] = [
    // macOS Application Menu
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { label: `About ${APP_NAME}`, click: showAbout },
              { type: 'separator' as const },
              {
                label: 'Preferences...',
                accelerator: 'Command+,',
                click: () => sendNavigation('/account/settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Close Window',
          accelerator: isMac ? 'Command+W' : 'Ctrl+W',
          role: 'close',
        },
        { type: 'separator' },
        {
          label: 'Export Report / Workspace...',
          accelerator: isMac ? 'Command+E' : 'Ctrl+E',
          click: () => {
            getTargetWindow()?.webContents.send('menu:export');
          },
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              { label: 'Quit', accelerator: 'Ctrl+Q', role: 'quit' as const },
            ]
          : []),
      ],
    },

    // Edit
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

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => getTargetWindow()?.webContents.toggleDevTools(),
        },
      ],
    },

    // Navigate
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: isMac ? 'Command+1' : 'Ctrl+1',
          click: () => sendNavigation('/dashboard'),
        },
        {
          label: 'Trading Terminal',
          accelerator: isMac ? 'Command+2' : 'Ctrl+2',
          click: () => sendNavigation('/account/terminal'),
        },
        {
          label: 'AI Signals',
          accelerator: isMac ? 'Command+3' : 'Ctrl+3',
          click: () => sendNavigation('/signals'),
        },
        {
          label: 'Market Scanner',
          accelerator: isMac ? 'Command+4' : 'Ctrl+4',
          click: () => sendNavigation('/scanner'),
        },
        {
          label: 'Strategy Lab',
          accelerator: isMac ? 'Command+5' : 'Ctrl+5',
          click: () => sendNavigation('/strategy-lab'),
        },
        {
          label: 'Portfolio',
          accelerator: isMac ? 'Command+6' : 'Ctrl+6',
          click: () => sendNavigation('/portfolio'),
        },
        {
          label: 'AI Copilot',
          accelerator: isMac ? 'Command+7' : 'Ctrl+7',
          click: () => sendNavigation('/ai-copilot'),
        },
        { type: 'separator' },
        {
          label: 'Account Settings',
          click: () => sendNavigation('/account/settings'),
        },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'AlgoVault Documentation',
          click: () => shell.openExternal('https://algovault.app/docs'),
        },
        {
          label: 'Release Notes',
          click: () =>
            shell.openExternal(
              'https://github.com/Alcatraz-Dev/Algo-Vault-EA-Lab/releases',
            ),
        },
        { type: 'separator' },
        { label: 'About AlgoVault', click: showAbout },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Global shortcuts are deliberately avoided for standard window commands
 * to respect macOS guidelines and prevent hijacking keystrokes across other apps.
 * Standard menu item accelerators handle all shortcuts automatically when focused.
 */
export function registerGlobalShortcuts(_actions: WindowActions): void {
  // Intentional no-op: accelerators in application menu are active when the app is focused.
}
