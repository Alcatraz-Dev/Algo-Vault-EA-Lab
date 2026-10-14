import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Preload bridge for AlgoVault Desktop.
 *
 * contextIsolation: true + nodeIntegration: false means the renderer cannot
 * touch Node or Electron directly. Everything it needs passes through this
 * secure, allowlisted IPC bridge.
 */

const APP_VERSION = '0.1.0';

const windowControls = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
};

const appBridge = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  restart: () => ipcRenderer.invoke('app:restart'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternally', url),
};

const dialogBridge = {
  showSaveDialog: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke('dialog:showSaveDialog', options),

  showOpenDialog: (options?: {
    title?: string;
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[];
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke('dialog:showOpenDialog', options),

  confirm: (options: {
    title?: string;
    message: string;
    detail?: string;
    type?: 'warning' | 'info' | 'question';
  }) => ipcRenderer.invoke('dialog:confirm', options),

  alert: (options: {
    title?: string;
    message: string;
    detail?: string;
  }) => ipcRenderer.invoke('dialog:alert', options),
};

const clipboardBridge = {
  writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  readText: () => ipcRenderer.invoke('clipboard:readText'),
};

const notificationBridge = {
  show: (options: { title: string; body: string }) =>
    ipcRenderer.invoke('notification:show', options),
};

const updaterBridge = {
  check: () => ipcRenderer.invoke('updater:check'),
  onUpdateAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('updater:update-available', handler);
    return () => {
      ipcRenderer.removeListener('updater:update-available', handler);
    };
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('updater:update-downloaded', handler);
    return () => {
      ipcRenderer.removeListener('updater:update-downloaded', handler);
    };
  },
  onError: (callback: (message: string) => void) => {
    const handler = (_event: IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('updater:error', handler);
    return () => {
      ipcRenderer.removeListener('updater:error', handler);
    };
  },
};

const navigationBridge = {
  onNavigate: (callback: (route: string) => void) => {
    const handler = (_event: IpcRendererEvent, route: string) => callback(route);
    ipcRenderer.on('navigation:go', handler);
    return () => {
      ipcRenderer.removeListener('navigation:go', handler);
    };
  },
  onMenuAction: (action: string, callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(`menu:${action}`, handler);
    return () => {
      ipcRenderer.removeListener(`menu:${action}`, handler);
    };
  },
};

const openExternal = (url: string): Promise<boolean> =>
  ipcRenderer.invoke('app:openExternally', url);

const connectionBridge = {
  getStatus: () => ipcRenderer.invoke('connection:getStatus') as Promise<{ online: boolean }>,
  onStatusChange: (callback: (status: { online: boolean }) => void) => {
    const onOnline = () => callback({ online: true });
    const onOffline = () => callback({ online: false });
    ipcRenderer.on('connection:online', onOnline);
    ipcRenderer.on('connection:offline', onOffline);
    return () => {
      ipcRenderer.removeListener('connection:online', onOnline);
      ipcRenderer.removeListener('connection:offline', onOffline);
    };
  },
};

const algovaultApi = {
  isDesktop: true as const,
  platform: process.platform,
  version: APP_VERSION,
  window: windowControls,
  app: appBridge,
  dialog: dialogBridge,
  clipboard: clipboardBridge,
  notification: notificationBridge,
  connection: connectionBridge,
  updater: updaterBridge,
  navigation: navigationBridge,
};

try {
  contextBridge.exposeInMainWorld('__ALGOVAULT_DESKTOP__', true);
  contextBridge.exposeInMainWorld('algovault', algovaultApi);
  // Backwards compatibility wrappers for the old surface used by ad-hoc scripts.
  contextBridge.exposeInMainWorld('app', appBridge);
  contextBridge.exposeInMainWorld('windowControls', windowControls);
  contextBridge.exposeInMainWorld('openExternal', openExternal);
} catch (err) {
  console.error('[desktop] preload bridge setup failed', err);
}