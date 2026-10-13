import { app } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
export const PROD_URL = 'http://127.0.0.1:3000';
export const APP_USER_DATA = app.getPath('userData');
// ---------------------------------------------------------------------------
// Next.js production server child process
// ---------------------------------------------------------------------------
let serverProc = null;
let serverPidFile = null;
function getNextPort() {
    const portFile = join(APP_USER_DATA, 'next-port');
    try {
        return Number(readFileSync(portFile, 'utf8').trim());
    }
    catch {
        return 3000;
    }
}
export function spawnNextServer() {
    if (serverProc)
        return getNextPort();
    const port = getNextPort();
    const env = { ...process.env, PORT: String(port) };
    const nextBin = process.platform === 'win32' ? 'node.exe' : 'node';
    serverProc = spawn(process.execPath, ['-r', 'ts-node/register', '-P', 'tsconfig.json', 'scripts/serve-next.ts'], {
        cwd: join(app.getAppPath(), '.next', 'standalone'),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
    });
    serverPidFile = join(APP_USER_DATA, 'next-server.pid');
    writeFileSync(serverPidFile, String(serverProc.pid));
    let ready = false;
    const timeout = setTimeout(() => {
        if (!ready) {
            ready = true;
            console.error('[desktop] next server did not become ready in time');
            terminateNextServer();
        }
    }, 25000);
    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        for (const line of text.split('\n')) {
            if (line.includes('started HTTP server') || line.includes('Ready in')) {
                if (!ready) {
                    ready = true;
                    clearTimeout(timeout);
                    console.log('[desktop] next server up on port', port);
                }
            }
            if (line.includes('EADDRINUSE')) {
                console.error('[desktop] port in use');
                terminateNextServer();
            }
            if (line.includes('Error')) {
                console.error('[desktop]', line);
            }
        }
    };
    serverProc.stdout?.on('data', onData);
    serverProc.stderr?.on('data', onData);
    serverProc.on('exit', (code) => {
        if (!ready)
            console.error('[desktop] next server exited with code', code);
        terminateNextServer();
        serverProc = null;
    });
    return port;
}
export function terminateNextServer() {
    if (!serverProc)
        return;
    try {
        serverProc.kill('SIGTERM');
    }
    catch {
        /* already dead */
    }
    serverProc = null;
    try {
        unlinkSync(serverPidFile);
    }
    catch {
        /* best effort */
    }
}
