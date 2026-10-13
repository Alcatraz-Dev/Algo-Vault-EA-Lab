import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json' with { type: 'json' };
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_NAME = pkg.name;
const APP_VERSION = pkg.version;
/**
 * Resolve the tray icon from both the dev tree and the packaged app.
 * `__dirname` is apps/desktop/src/main (dev) or apps/desktop/compiled/main (bundle),
 * so two levels up is apps/desktop in both cases.
 */
function getIconPath() {
    return join(__dirname, '..', '..', 'public', 'icons', 'algovault-logo-32.png');
}
export function createTray() {
    if (!app.isReady())
        return null;
    try {
        const icon = nativeImage.createFromPath(getIconPath());
        if (icon.isEmpty()) {
            console.warn('[desktop] tray icon missing at', getIconPath());
            return null;
        }
        const tray = new Tray(icon);
        tray.setToolTip(`${APP_NAME} v${APP_VERSION}`);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open', click: () => BrowserWindow.getFocusedWindow()?.show() },
            { type: 'separator' },
            { label: 'Hide', click: () => BrowserWindow.getFocusedWindow()?.hide() },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() },
        ]);
        tray.setContextMenu(contextMenu);
        return tray;
    }
    catch (err) {
        console.warn('[desktop] tray init failed', err);
        return null;
    }
}
