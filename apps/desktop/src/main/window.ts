import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getActiveUrl, waitForServer, log } from './next-server.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

const MIN_WIDTH = 1280;
const MIN_HEIGHT = 780;

function readState(): WindowState {
  try {
    const file = join(app.getPath('userData'), 'window-state.json');
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      width: typeof parsed.width === 'number' ? parsed.width : 1280,
      height: typeof parsed.height === 'number' ? parsed.height : 780,
      x: typeof parsed.x === 'number' ? parsed.x : 0,
      y: typeof parsed.y === 'number' ? parsed.y : 0,
      maximized: !!parsed.maximized,
    };
  } catch {
    return { width: 1280, height: 780, x: 0, y: 0, maximized: false };
  }
}

function writeState(state: WindowState): void {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'window-state.json'), JSON.stringify(state));
  } catch {
    // Non-critical: geometry is convenience state only.
  }
}


let mainWindow: BrowserWindow | null = null;
let currentState: WindowState = { width: 1280, height: 780, x: 0, y: 0, maximized: false };

/** Show an error page when the server fails to start. */
function loadErrorPage(win: BrowserWindow, message: string): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AlgoVault — Startup Error</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0b0c0e; color: #f4f4f5;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; }
    .box { text-align: center; max-width: 480px; padding: 2rem; }
    h1 { font-size: 1.4rem; color: #f97316; margin-bottom: 1rem; }
    pre { background: #18181b; padding: 1rem; border-radius: 8px; font-size: 0.85rem;
          text-align: left; overflow: auto; white-space: pre-wrap; word-break: break-all; }
    p { color: #a1a1aa; font-size: 0.9rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Failed to start AlgoVault</h1>
    <pre>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    <p>Check ~/Library/Application Support/AlgoVault/desktop.log for details.</p>
  </div>
</body>
</html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function createWindow(): BrowserWindow {
  // Read persisted geometry on first call.
  currentState = readState();

  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const { width, height } = currentState;
  const x = Math.max(0, Math.min(currentState.x, Math.max(0, workArea.width - width)));
  const y = Math.max(0, Math.min(currentState.y, Math.max(0, workArea.height - height)));

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: true,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: process.platform !== 'darwin',
    // Don't show the window until the renderer is ready — avoids flash.
    show: false,
    backgroundColor: '#0b0c0e',
    webPreferences: {
      preload: existsSync(join(__dirname, '..', 'preload', 'index.cjs'))
        ? join(__dirname, '..', 'preload', 'index.cjs')
        : join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !process.env.ELECTRON_NO_DEV_TOOLS,
    },
  });

  mainWindow = win;

  if (currentState.maximized) win.maximize();

  // Show once renderer has content (avoids blank white flash).
  win.once('ready-to-show', () => win.show());

  win.on('close', () => {
    const rect = win.getBounds();
    currentState = {
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
      maximized: win.isMaximized(),
    };
    writeState(currentState);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Log renderer-side failures.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
    log('ERROR', `did-fail-load: code=${errorCode} desc="${errorDescription}" url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('ERROR', 'render-process-gone:', details.reason, details.exitCode);
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log('WARN', `[renderer console] ${source}:${line}: ${message}`);
  });

  // Wait for server readiness then load — or show an error page if it fails.
  log('INFO', 'Waiting for Next.js server before loading renderer…');
  waitForServer()
    .then(() => {
      const url = getActiveUrl();
      log('INFO', 'Server ready — loading', url);
      if (!win.isDestroyed()) win.loadURL(url);
    })
    .catch((err: Error) => {
      log('ERROR', 'Server failed to start:', err.message);
      if (!win.isDestroyed()) {
        loadErrorPage(win, err.message);
        win.show();
      }
    });

  if (process.env.ALGOVAULT_DEV) {
    setTimeout(() => win.webContents.openDevTools({ mode: 'detach' }), 2000);
  }

  return win;
}

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}

export function minimizeWindow(): void {
  mainWindow?.minimize();
}

export function maximizeWindow(): void {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
}

export function closeWindow(): void {
  mainWindow?.close();
}

export function isMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false;
}
