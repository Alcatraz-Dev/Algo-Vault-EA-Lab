import EventEmitter from 'node:events';
const emitter = new EventEmitter();
// Electron main process has no `window`/`navigator` — only the renderer does.
let online = true;
if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    online = navigator.onLine;
}
function update() {
    const nowOnline = typeof navigator !== 'undefined' && navigator.onLine === true;
    if (nowOnline !== online) {
        online = nowOnline;
        if (online) {
            emitter.emit('online');
        }
        else {
            emitter.emit('offline');
        }
    }
}
// Set up a bidirectional channel: the renderer listens to OS network changes
// (the `window` event), and the main process pushes on the same emitter so
// both sides of the contextBridge stay in sync.
function addBrowserListeners() {
    if (typeof window === 'undefined')
        return;
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
}
addBrowserListeners();
export const connection = {
    online,
    onOnline(listener) {
        emitter.on('online', listener);
    },
    onOffline(listener) {
        emitter.on('offline', listener);
    },
};
