import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { log } from './next-server.js';
/**
 * OS-level network connectivity detection for the AlgoVault desktop shell.
 *
 * The Electron main process has no `window` or `navigator`, so we probe the OS
 * directly. The signal:
 *
 *   1. DNS — `dns.lookup` on a well-known host reports whether the resolver
 *      itself is reachable (handles captive portals, DNS-only outages, link
 *      down — all the states where the OS is "offline" from the user's POV).
 *
 * DNS alone is sufficient: any user-meaningful "the feed is down" state is
 * either DNS failure or upstream unreachability, both of which this catches.
 */
const PROBE_HOSTS = [
    // Cloudflare — any of these resolving means the DNS resolver and the
    // upstream network path are functional.
    '1.1.1.1',
];
const PROBE_INTERVAL_MS = 5000;
const PROBE_TIMEOUT_MS = 2500;
const emitter = new EventEmitter();
let online = true;
let lastReported = true;
let timer = null;
function probeDns() {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        dns.lookup(PROBE_HOSTS[0], { family: 4 }, (err) => finish(!err));
        setTimeout(() => finish(false), PROBE_TIMEOUT_MS).unref?.();
    });
}
async function tick() {
    // DNS alone is the right signal for "do I have an upstream path?".
    // The loopback HTTP probe was redundant — port 80 is rarely open on
    // modern desktops and adds nothing the DNS check doesn't already cover.
    const dnsOk = await probeDns();
    online = dnsOk;
    if (online !== lastReported) {
        lastReported = online;
        log(online ? 'INFO' : 'WARN', 'connectivity changed →', online ? 'online' : 'offline');
        emitter.emit(online ? 'online' : 'offline');
    }
}
function start() {
    if (timer)
        return;
    // First tick after a short delay so the app has time to settle.
    timer = setTimeout(function loop() {
        void tick();
        timer = setTimeout(loop, PROBE_INTERVAL_MS);
    }, 1500);
    timer.unref?.();
}
function stop() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}
export const connection = {
    get online() {
        return online;
    },
    start,
    stop,
    onOnline(listener) {
        emitter.on('online', listener);
        return () => emitter.off('online', listener);
    },
    onOffline(listener) {
        emitter.on('offline', listener);
        return () => emitter.off('offline', listener);
    },
};
