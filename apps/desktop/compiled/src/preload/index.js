import { contextBridge, ipcRenderer } from 'electron';
/**
 * Preload bridge.
 *
 * contextIsolation: true + nodeIntegration: false means the renderer cannot
 * touch Node or Electron directly. Everything it needs passes through here.
 * The surface is deliberately narrow.
 */
const window = {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
};
const app = {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    restart: () => ipcRenderer.invoke('app:restart'),
    quit: () => ipcRenderer.invoke('app:quit'),
    /** openExternally is allowlist-gated in main; returns false for blocked URLs. */
    openExternally: (url) => ipcRenderer.invoke('app:openExternally', url),
};
const connection = {
    online: false,
    offline: false,
};
const updater = {
    check: () => ipcRenderer.invoke('updater:check'),
    onUpdate: () => { },
};
/** Safe openExternal: allowlisted origins only (see `shared/links.ts`). */
const openExternal = (url) => ipcRenderer.invoke('app:openExternally', url);
try {
    contextBridge.exposeInMainWorld('window', window);
    contextBridge.exposeInMainWorld('app', app);
    contextBridge.exposeInMainWorld('connection', connection);
    contextBridge.exposeInMainWorld('updater', updater);
    contextBridge.exposeInMainWorld('openExternal', openExternal);
}
catch (err) {
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
    updater.onUpdate?.();
});
ipcRenderer.on('updater:update-downloaded', () => {
    updater.onUpdate?.();
});
ipcRenderer.on('updater:error', (_event, message) => {
    console.warn('[desktop] updater error:', message);
});
