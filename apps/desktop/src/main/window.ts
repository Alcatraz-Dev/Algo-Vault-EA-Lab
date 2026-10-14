import { app, BrowserWindow, screen, Menu, MenuItem, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getActiveUrl, waitForServer, log } from './next-server.js';
import { isOriginAllowlisted } from '../shared/links.js';

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
const DEFAULT_WIDTH = 1380;
const DEFAULT_HEIGHT = 860;

/**
 * Design-system tokens mirrored from `app/globals.css` so the desktop chrome
 * matches the web app's surface and accent colours exactly. Keeping these in
 * sync by hand is cheaper than reading the compiled CSS at runtime.
 */
const DESIGN = {
  bg: '#0b0c0e',           // zinc-950 — primary window surface
  bgElevated: '#121316',   // zinc-900/950 mix — title bar / cards
  border: '#27272a',       // zinc-800 — subtle separators
  text: '#e4e4e7',         // zinc-200 — primary text
  textMuted: '#a1a1aa',    // zinc-400 — secondary text
  accent: '#f97316',       // Ember — brand accent for traffic-light / focus
} as const;

/**
 * macOS-only: the title bar overlay tint and traffic-light position.
 *
 * On `dark` Aqua we use a solid Ember-tinted dark surface so the window
 * integrates with the macOS dark menu bar. On `light` we soften it so it
 * remains legible against the system light chrome.
 *
 * `trafficLightPosition` aligns the three macOS controls with the
 * 16-px grid the design system uses for the in-app header.
 */
type VibrancyKind = 'under-window' | 'sidebar';
type MacChrome = {
  titleBarStyle: 'hiddenInset';
  trafficLightPosition: { x: number; y: number };
  titleBarOverlay: { color: string; symbolColor: string; height: number };
  vibrancy: VibrancyKind;
  visualEffectState: 'active';
};

function macChrome(): MacChrome {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    titleBarOverlay: {
      color: dark ? DESIGN.bg : '#fafafa',
      symbolColor: dark ? DESIGN.accent : '#3f3f46',
      height: 44,
    },
    vibrancy: dark ? 'under-window' : 'sidebar',
    visualEffectState: 'active',
  };
}

function readState(): WindowState {
  try {
    const file = join(app.getPath('userData'), 'window-state.json');
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      width:
        typeof parsed.width === 'number'
          ? Math.max(MIN_WIDTH, parsed.width)
          : DEFAULT_WIDTH,
      height:
        typeof parsed.height === 'number'
          ? Math.max(MIN_HEIGHT, parsed.height)
          : DEFAULT_HEIGHT,
      x: typeof parsed.x === 'number' ? parsed.x : 0,
      y: typeof parsed.y === 'number' ? parsed.y : 0,
      maximized: Boolean(parsed.maximized),
    };
  } catch {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      x: 0,
      y: 0,
      maximized: false,
    };
  }
}

function writeState(state: WindowState): void {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'window-state.json'), JSON.stringify(state));
  } catch {
    // Non-critical: window geometry persistence failure is non-fatal.
  }
}

let mainWindow: BrowserWindow | null = null;
let currentState: WindowState = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  x: 0,
  y: 0,
  maximized: false,
};

/** Show a graceful error page when the Next.js server fails to start. */
function loadErrorPage(win: BrowserWindow, message: string): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AlgoVault — Startup Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #0b0c0e; color: #f4f4f5;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; user-select: none; }
    .box { text-align: center; max-width: 500px; padding: 2.5rem; background: #121316;
           border: 1px solid #27272a; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
    .badge { display: inline-block; padding: 4px 10px; background: rgba(249, 115, 22, 0.15);
             color: #f97316; border-radius: 6px; font-size: 0.75rem; font-weight: 600; margin-bottom: 1rem; }
    h1 { font-size: 1.3rem; margin: 0 0 0.75rem 0; font-weight: 600; }
    p { color: #a1a1aa; font-size: 0.9rem; line-height: 1.5; margin: 0 0 1.25rem 0; }
    pre { background: #0b0c0e; border: 1px solid #27272a; padding: 0.85rem; border-radius: 8px;
          font-size: 0.8rem; text-align: left; overflow: auto; max-height: 160px;
          white-space: pre-wrap; word-break: break-all; color: #fb7185; }
    button { background: #f97316; color: #0b0c0e; font-weight: 600; border: none;
             padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
    button:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="box">
    <div class="badge">Desktop Shell</div>
    <h1>Unable to connect to AlgoVault Server</h1>
    <p>The internal service encountered an issue while starting. Please check the logs or restart the application.</p>
    <pre>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    <div style="margin-top: 1.5rem;">
      <button onclick="location.reload()">Retry Connection</button>
    </div>
  </div>
</body>
</html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function createWindow(): BrowserWindow {
  currentState = readState();

  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;

  const width = Math.min(
    workArea.width,
    Math.max(MIN_WIDTH, currentState.width),
  );
  const height = Math.min(
    workArea.height,
    Math.max(MIN_HEIGHT, currentState.height),
  );

  // Position: use stored coords if inside bounds, else center on screen
  const x =
    currentState.x > workArea.x - 100 &&
    currentState.x < workArea.x + workArea.width - 200
      ? currentState.x
      : Math.round(workArea.x + (workArea.width - width) / 2);
  const y =
    currentState.y > workArea.y - 100 &&
    currentState.y < workArea.y + workArea.height - 200
      ? currentState.y
      : Math.round(workArea.y + (workArea.height - height) / 2);

  const preloadPath = join(__dirname, '..', 'preload', 'index.cjs');
  log('INFO', 'Configuring window with preload path:', preloadPath);

  const win = new BrowserWindow({
    title: 'AlgoVault',
    width,
    height,
    x,
    y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: true,
    autoHideMenuBar: process.platform !== 'darwin',
    show: false,
    backgroundColor: DESIGN.bg,
    // macOS gets the full hidden-inset + vibrancy treatment; Windows/Linux
    // keep the OS frame so users get the native window controls.
    ...(process.platform === 'darwin' ? macChrome() : {
      titleBarStyle: 'default' as const,
      // Mica gives Windows 11 a tasteful native-tinted chrome.
      ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    }),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !process.env.ELECTRON_NO_DEV_TOOLS,
      sandbox: true,
      // Smooth visuals — match the web app's 60fps target.
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  if (currentState.maximized) {
    win.maximize();
  }

  // Re-apply title bar overlay when the OS theme changes so the chrome stays
  // in sync with the system appearance without restarting the app.
  if (process.platform === 'darwin') {
    const refresh = () => {
      if (win.isDestroyed()) return;
      const next = macChrome();
      win.setTitleBarOverlay?.(next.titleBarOverlay);
      win.setVibrancy?.(next.vibrancy);
    };
    nativeTheme.on('updated', refresh);
    win.on('closed', () => nativeTheme.off('updated', refresh));
  }

  // Prevent white flash: show only when content is ready
  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const rect = win.getBounds();
      currentState = {
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        maximized: win.isMaximized(),
      };
      writeState(currentState);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Native context menu (Right-click)
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'undo' }));
      menu.append(new MenuItem({ role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
    }

    if (process.env.ALGOVAULT_DEV || !app.isPackaged) {
      if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: 'Inspect Element',
          click: () => win.webContents.inspectElement(params.x, params.y),
        }),
      );
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // Secure External Link Navigation
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOriginAllowlisted(url)) {
      shell.openExternal(url);
    } else {
      log('WARN', 'Blocked external window open for non-allowlisted url:', url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    let isInternal = false;
    try {
      isInternal = new URL(url).origin === new URL(getActiveUrl()).origin;
    } catch {
      // Invalid navigation targets are never trusted.
    }

    if (!isInternal) {
      event.preventDefault();
      if (isOriginAllowlisted(url)) {
        void shell.openExternal(url).catch((error: unknown) => {
          log('WARN', 'Could not open external navigation:', String(error));
        });
      } else {
        log('WARN', 'Blocked external navigation:', url);
      }
    }
  });

  // Log renderer-side failures
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
    log('ERROR', `did-fail-load: code=${errorCode} desc="${errorDescription}" url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('ERROR', 'render-process-gone:', details.reason, details.exitCode);
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log('WARN', `[renderer console] ${source}:${line}: ${message}`);
  });

  // Wait for server readiness then load
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
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' });
    }, 2000);
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
