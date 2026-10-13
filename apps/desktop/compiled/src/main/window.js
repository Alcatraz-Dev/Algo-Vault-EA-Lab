import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { APP_USER_DATA, PROD_URL } from './next-server.js';
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 780;
function readState() {
    const file = join(APP_USER_DATA, 'window-state.json');
    try {
        const raw = readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            width: typeof parsed.width === 'number' ? parsed.width : 1280,
            height: typeof parsed.height === 'number' ? parsed.height : 780,
            x: typeof parsed.x === 'number' ? parsed.x : 0,
            y: typeof parsed.y === 'number' ? parsed.y : 0,
            maximized: !!parsed.maximized,
        };
    }
    catch {
        return { width: 1280, height: 780, x: 0, y: 0, maximized: false };
    }
}
function writeState(state) {
    try {
        mkdirSync(APP_USER_DATA, { recursive: true });
        writeFileSync(join(APP_USER_DATA, 'window-state.json'), JSON.stringify(state));
    }
    catch {
        // Geometry is non-sensitive convenience state; ignore write failures.
    }
}
let mainWindow = null;
let currentState = readState();
export function createWindow() {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const { width, height } = currentState;
    // Constrain geometry to the current display.
    const x = Math.max(0, Math.min(currentState.x, Math.max(0, workArea.width - width)));
    const y = Math.max(0, Math.min(currentState.y, Math.max(0, workArea.height - height)));
    const options = {
        width,
        height,
        x,
        y,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        frame: true,
        titleBarStyle: 'hiddenInset',
        autoHideMenuBar: process.platform !== 'darwin',
        show: false,
        backgroundColor: '#0b0c0e',
        webPreferences: {
            preload: join(__dirname, '..', 'preload', 'index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !!process.env.ALGOVAULT_DEV,
        },
    };
    mainWindow = new BrowserWindow(options);
    // Restore a window that was maximized (positions are then ignored).
    if (currentState.maximized) {
        mainWindow.maximize();
    }
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.show();
    });
    mainWindow.on('ready-to-show', () => {
        if (!mainWindow)
            return;
        mainWindow.show();
    });
    mainWindow.on('close', (event) => {
        if (mainWindow && mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }
        // Persist geometry only when the user actually closes (not via menu/alt-f4).
        // Electron has no direct "user closed" signal other than this; we still
        // record safe geometry so a subsequent launch is sensible.
        const rect = mainWindow?.getBounds();
        if (rect) {
            currentState = {
                width: rect.width,
                height: rect.height,
                x: rect.x,
                y: rect.y,
                maximized: mainWindow?.isMaximized() ?? false,
            };
        }
        writeState(currentState);
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Serve the production build from the root workspace.
    mainWindow.loadURL(PROD_URL);
    // Re-open DevTools in developer mode.
    if (process.env.ALGOVAULT_DEV) {
        setTimeout(() => mainWindow?.webContents.openDevTools({ mode: 'detach' }), 1000);
    }
    return mainWindow;
}
export function getWindow() {
    return mainWindow;
}
export function minimizeWindow() {
    mainWindow?.minimize();
}
export function maximizeWindow() {
    if (!mainWindow)
        return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
}
export function closeWindow() {
    mainWindow?.close();
}
export function isMaximized() {
    return mainWindow?.isMaximized() ?? false;
}
