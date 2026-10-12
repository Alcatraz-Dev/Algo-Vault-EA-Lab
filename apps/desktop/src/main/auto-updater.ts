import { autoUpdater } from 'electron';
import EventEmitter from 'node:events';

export interface UpdaterEvents {
  'checking-for-update': () => void;
  'update-available': () => void;
  'update-downloaded': () => void;
  'update-not-available': () => void;
  error: (message: string) => void;
}

const emitter = new EventEmitter();

export function checkForUpdates(): void {
  emitter.emit('checking-for-update');
  autoUpdater.checkForUpdates();
}

// Bridge the electron auto-updater onto our event emitter.
autoUpdater.on('checking-for-update', () => emitter.emit('checking-for-update'));
autoUpdater.on('update-available', () => emitter.emit('update-available'));
autoUpdater.on('update-downloaded', () => emitter.emit('update-downloaded'));
autoUpdater.on('update-not-available', () => emitter.emit('update-not-available'));
autoUpdater.on('error', (error: Error) => emitter.emit('error', error.message));

export const updater = {
  check: checkForUpdates,
  on(event: keyof UpdaterEvents, listener: (...args: unknown[]) => void): void {
    emitter.on(event, listener);
  },
};
