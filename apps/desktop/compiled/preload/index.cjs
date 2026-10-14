"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * Preload bridge for AlgoVault Desktop.
 *
 * contextIsolation: true + nodeIntegration: false means the renderer cannot
 * touch Node or Electron directly. Everything it needs passes through this
 * secure, allowlisted IPC bridge.
 */
const APP_VERSION = '0.1.0';
const windowControls = {
    minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
    close: () => electron_1.ipcRenderer.invoke('window:close'),
    isMaximized: () => electron_1.ipcRenderer.invoke('window:isMaximized'),
    isFullScreen: () => electron_1.ipcRenderer.invoke('window:isFullScreen'),
};
const appBridge = {
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    restart: () => electron_1.ipcRenderer.invoke('app:restart'),
    quit: () => electron_1.ipcRenderer.invoke('app:quit'),
    openExternal: (url) => electron_1.ipcRenderer.invoke('app:openExternally', url),
};
const dialogBridge = {
    showSaveDialog: (options) => electron_1.ipcRenderer.invoke('dialog:showSaveDialog', options),
    showOpenDialog: (options) => electron_1.ipcRenderer.invoke('dialog:showOpenDialog', options),
    confirm: (options) => electron_1.ipcRenderer.invoke('dialog:confirm', options),
    alert: (options) => electron_1.ipcRenderer.invoke('dialog:alert', options),
};
const clipboardBridge = {
    writeText: (text) => electron_1.ipcRenderer.invoke('clipboard:writeText', text),
    readText: () => electron_1.ipcRenderer.invoke('clipboard:readText'),
};
const notificationBridge = {
    show: (options) => electron_1.ipcRenderer.invoke('notification:show', options),
};
const updaterBridge = {
    check: () => electron_1.ipcRenderer.invoke('updater:check'),
    onUpdateAvailable: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('updater:update-available', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('updater:update-available', handler);
        };
    },
    onUpdateDownloaded: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('updater:update-downloaded', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('updater:update-downloaded', handler);
        };
    },
    onError: (callback) => {
        const handler = (_event, message) => callback(message);
        electron_1.ipcRenderer.on('updater:error', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('updater:error', handler);
        };
    },
};
const navigationBridge = {
    onNavigate: (callback) => {
        const handler = (_event, route) => callback(route);
        electron_1.ipcRenderer.on('navigation:go', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('navigation:go', handler);
        };
    },
    onMenuAction: (action, callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on(`menu:${action}`, handler);
        return () => {
            electron_1.ipcRenderer.removeListener(`menu:${action}`, handler);
        };
    },
};
const openExternal = (url) => electron_1.ipcRenderer.invoke('app:openExternally', url);
const connectionBridge = {
    getStatus: () => electron_1.ipcRenderer.invoke('connection:getStatus'),
    onStatusChange: (callback) => {
        const onOnline = () => callback({ online: true });
        const onOffline = () => callback({ online: false });
        electron_1.ipcRenderer.on('connection:online', onOnline);
        electron_1.ipcRenderer.on('connection:offline', onOffline);
        return () => {
            electron_1.ipcRenderer.removeListener('connection:online', onOnline);
            electron_1.ipcRenderer.removeListener('connection:offline', onOffline);
        };
    },
};
const algovaultApi = {
    isDesktop: true,
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
    electron_1.contextBridge.exposeInMainWorld('__ALGOVAULT_DESKTOP__', true);
    electron_1.contextBridge.exposeInMainWorld('algovault', algovaultApi);
    // Backwards compatibility wrappers for the old surface used by ad-hoc scripts.
    electron_1.contextBridge.exposeInMainWorld('app', appBridge);
    electron_1.contextBridge.exposeInMainWorld('windowControls', windowControls);
    electron_1.contextBridge.exposeInMainWorld('openExternal', openExternal);
}
catch (err) {
    console.error('[desktop] preload bridge setup failed', err);
}
