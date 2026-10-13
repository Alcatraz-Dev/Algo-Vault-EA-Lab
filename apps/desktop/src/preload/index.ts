import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Preload bridge.
 *
 * contextIsolation: true + nodeIntegration: false means the renderer cannot
 * touch Node or Electron directly. Everything it needs passes through here.
 * The surface is deliberately narrow.
 */
const window: Record<string, (...args: any[]) => unknown> = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
};

const app: Record<string, (...args: any[]) => unknown> = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  restart: () => ipcRenderer.invoke('app:restart'),
  quit: () => ipcRenderer.invoke('app:quit'),
  /** openExternally is allowlist-gated in main; returns false for blocked URLs. */
  openExternally: (url: string) => ipcRenderer.invoke('app:openExternally', url),
};

const connection: Record<string, boolean> = {
  online: false,
  offline: false,
};

const updater: Record<string, unknown> = {
  check: () => ipcRenderer.invoke('updater:check'),
  onUpdate: () => {},
};

/** Safe openExternal: allowlisted origins only (see `shared/links.ts`). */
const openExternal = (url: string): Promise<boolean> =>
  ipcRenderer.invoke('app:openExternally', url);

try {
  contextBridge.exposeInMainWorld('window', window);
  contextBridge.exposeInMainWorld('app', app);
  contextBridge.exposeInMainWorld('connection', connection);
  contextBridge.exposeInMainWorld('updater', updater);
  contextBridge.exposeInMainWorld('openExternal', openExternal);
} catch (err) {
  console.error('[desktop] preload bridge setup failed', err);
}

// Listen for feed-connection signals pushed by the main process.
ipcRenderer.on('connection:online', () => {
  connection.online = true;
  connection.offline = false;
});
ipcRenderer.on('connection:offline', () => {
  connection.offline = true;
  connection.online = false;
});
ipcRenderer.on('updater:update-available', () => {
  (updater as { onUpdate?: () => void }).onUpdate?.();
});
ipcRenderer.on('updater:update-downloaded', () => {
  (updater as { onUpdate?: () => void }).onUpdate?.();
});
ipcRenderer.on('updater:error', (_event: IpcRendererEvent, message: string) => {
  console.warn('[desktop] updater error:', message);
});
