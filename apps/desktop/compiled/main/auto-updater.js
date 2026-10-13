import { autoUpdater } from 'electron';
import EventEmitter from 'node:events';
const emitter = new EventEmitter();
export function checkForUpdates() {
    emitter.emit('checking-for-update');
    autoUpdater.checkForUpdates();
}
// Bridge the electron auto-updater onto our event emitter.
autoUpdater.on('checking-for-update', () => emitter.emit('checking-for-update'));
autoUpdater.on('update-available', () => emitter.emit('update-available'));
autoUpdater.on('update-downloaded', () => emitter.emit('update-downloaded'));
autoUpdater.on('update-not-available', () => emitter.emit('update-not-available'));
autoUpdater.on('error', (error) => emitter.emit('error', error.message));
export const updater = {
    check: checkForUpdates,
    on(event, listener) {
        emitter.on(event, listener);
    },
};
