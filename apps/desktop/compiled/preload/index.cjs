"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * Preload bridge.
 *
 * contextIsolation: true + nodeIntegration: false means the renderer cannot
 * touch Node or Electron directly. Everything it needs passes through here.
 * The surface is deliberately narrow.
 */
const windowControls = {
    minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
    close: () => electron_1.ipcRenderer.invoke('window:close'),
    isMaximized: () => electron_1.ipcRenderer.invoke('window:isMaximized'),
};
const app = {
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    restart: () => electron_1.ipcRenderer.invoke('app:restart'),
    quit: () => electron_1.ipcRenderer.invoke('app:quit'),
    /** openExternally is allowlist-gated in main; returns false for blocked URLs. */
    openExternally: (url) => electron_1.ipcRenderer.invoke('app:openExternally', url),
};
const connection = {
    online: false,
    offline: false,
};
const updater = {
    check: () => electron_1.ipcRenderer.invoke('updater:check'),
    onUpdate: () => { },
};
/** Safe openExternal: allowlisted origins only (see `shared/links.ts`). */
const openExternal = (url) => electron_1.ipcRenderer.invoke('app:openExternally', url);
try {
    electron_1.contextBridge.exposeInMainWorld('windowControls', windowControls);
    electron_1.contextBridge.exposeInMainWorld('desktop', { ...windowControls, app, connection, updater, openExternal });
    electron_1.contextBridge.exposeInMainWorld('electron', { window: windowControls, app, connection, updater, openExternal });
    electron_1.contextBridge.exposeInMainWorld('app', app);
    electron_1.contextBridge.exposeInMainWorld('connection', connection);
    electron_1.contextBridge.exposeInMainWorld('updater', updater);
    electron_1.contextBridge.exposeInMainWorld('openExternal', openExternal);
}
catch (err) {
    console.error('[desktop] preload bridge setup failed', err);
}
// Listen for feed-connection signals pushed by the main process.
electron_1.ipcRenderer.on('connection:online', () => {
    connection.online = true;
    connection.offline = false;
});
electron_1.ipcRenderer.on('connection:offline', () => {
    connection.offline = true;
    connection.online = false;
});
electron_1.ipcRenderer.on('updater:update-available', () => {
    updater.onUpdate?.();
});
electron_1.ipcRenderer.on('updater:update-downloaded', () => {
    updater.onUpdate?.();
});
electron_1.ipcRenderer.on('updater:error', (_event, message) => {
    console.warn('[desktop] updater error:', message);
});
