import { app } from 'electron';
import { join } from 'node:path';
import { buildNextServerEnv } from './server-env.js';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync, } from 'node:fs';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
// ---------------------------------------------------------------------------
// Constants & Port configuration
// ---------------------------------------------------------------------------
let activePort = 3000;
export function getActivePort() {
    return activePort;
}
export function getActiveUrl() {
    return `http://127.0.0.1:${activePort}`;
}
/** Check if a port is truly available by testing connection and bind. */
export function findAvailablePort(preferred = 3000) {
    return new Promise((resolve) => {
        // Check if something is already accepting connections on preferred port
        const tester = net.createConnection({ port: preferred, host: '127.0.0.1' });
        tester.once('connect', () => {
            tester.destroy();
            // Port in use — allocate random free port
            const ephemeral = net.createServer();
            ephemeral.listen(0, '127.0.0.1', () => {
                const addr = ephemeral.address();
                const freePort = typeof addr === 'object' && addr ? addr.port : 3001;
                ephemeral.close(() => resolve(freePort));
            });
        });
        tester.once('error', () => {
            // Nothing listening — verify bind to 0.0.0.0
            const server = net.createServer();
            server.once('error', () => {
                const fallback = net.createServer();
                fallback.listen(0, '127.0.0.1', () => {
                    const addr = fallback.address();
                    const freePort = typeof addr === 'object' && addr ? addr.port : 3001;
                    fallback.close(() => resolve(freePort));
                });
            });
            server.listen({ port: preferred, host: '0.0.0.0' }, () => {
                server.close(() => resolve(preferred));
            });
        });
    });
}
export const PROD_PORT = 3000;
export const PROD_URL = `http://127.0.0.1:${PROD_PORT}`;
// ---------------------------------------------------------------------------
// Logging — writes to <userData>/desktop.log; never throws
// ---------------------------------------------------------------------------
let _logPath = null;
function logPath() {
    if (!_logPath) {
        const dir = app.getPath('userData');
        try {
            mkdirSync(dir, { recursive: true });
        }
        catch { /* ignore */ }
        _logPath = join(dir, 'desktop.log');
        // Truncate on each fresh launch so logs don't grow unbounded.
        try {
            writeFileSync(_logPath, `=== AlgoVault launch ${new Date().toISOString()} ===\n`);
        }
        catch { /* ignore */ }
    }
    return _logPath;
}
export function log(level, ...args) {
    const line = `[${level}] ${args.map(String).join(' ')}\n`;
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](`[desktop]`, ...args);
    try {
        appendFileSync(logPath(), line);
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
/**
 * Resolve the Next.js standalone directory.
 *
 * In production (packaged app):
 *   Contents/Resources/app.asar          ← getAppPath()
 *   Contents/Resources/                  ← process.resourcesPath
 *   Contents/Resources/standalone/       ← extraResources target ("to": "standalone")
 *
 * In development (npm run dev / electron .):
 *   <repo>/.next/standalone/
 */
export function resolveStandaloneDir() {
    if (app.isPackaged) {
        // electron-builder extraResources copies to process.resourcesPath/<to>
        return join(process.resourcesPath, 'standalone');
    }
    // Development: two levels up from apps/desktop/src/main → repo root
    return join(__dirname, '..', '..', '..', '..', '.next', 'standalone');
}
// ---------------------------------------------------------------------------
// Server process
// ---------------------------------------------------------------------------
let serverProc = null;
let serverReady = false;
let readyResolve = null;
let readyReject = null;
/** Resolves when the embedded server responds on PROD_PORT, or rejects on timeout/crash. */
export function waitForServer() {
    return new Promise((resolve, reject) => {
        if (serverReady) {
            resolve();
            return;
        }
        readyResolve = resolve;
        readyReject = reject;
    });
}
export async function spawnNextServer() {
    if (serverProc)
        return;
    activePort = await findAvailablePort(3000);
    log('INFO', 'Selected port:', activePort);
    const standaloneDir = resolveStandaloneDir();
    const serverJs = join(standaloneDir, 'server.js');
    log('INFO', 'app.isPackaged:', app.isPackaged);
    log('INFO', 'process.resourcesPath:', process.resourcesPath);
    log('INFO', 'standalone dir:', standaloneDir);
    log('INFO', 'server.js path:', serverJs);
    if (!existsSync(serverJs)) {
        const msg = `Next.js server entry not found: ${serverJs}`;
        log('ERROR', msg);
        readyReject?.(new Error(msg));
        return;
    }
    const env = buildNextServerEnv({
        source: process.env,
        port: activePort,
        isPackaged: app.isPackaged,
    });
    log('INFO', `Spawning: ${process.execPath} server.js in ${standaloneDir} on port ${activePort}`);
    serverProc = spawn(process.execPath, ['server.js'], {
        cwd: standaloneDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    // Write PID for crash diagnostics
    const pidFile = join(app.getPath('userData'), 'next-server.pid');
    try {
        mkdirSync(app.getPath('userData'), { recursive: true });
        writeFileSync(pidFile, String(serverProc.pid ?? ''));
    }
    catch { /* ignore */ }
    const STARTUP_TIMEOUT_MS = 40000;
    let pollInterval = null;
    const markReady = (reason) => {
        if (serverReady)
            return;
        serverReady = true;
        clearTimeout(timeoutHandle);
        if (pollInterval)
            clearInterval(pollInterval);
        log('INFO', 'Next.js server ready on port', activePort, `(${reason})`);
        readyResolve?.();
    };
    const timeoutHandle = setTimeout(() => {
        if (!serverReady) {
            if (pollInterval)
                clearInterval(pollInterval);
            log('ERROR', 'Next.js server startup timed out after', STARTUP_TIMEOUT_MS, 'ms');
            readyReject?.(new Error('Server startup timeout'));
            terminateNextServer();
        }
    }, STARTUP_TIMEOUT_MS);
    timeoutHandle.unref?.();
    // Active HTTP polling every 250ms to detect server readiness immediately,
    // even if stdout is buffered by Node when running without a TTY.
    const checkHttpReady = () => {
        if (serverReady)
            return;
        const req = http.get(getActiveUrl(), (res) => {
            markReady(`HTTP response ${res.statusCode}`);
        });
        req.on('error', () => {
            // Expected while server is booting
        });
        req.setTimeout(300, () => req.destroy());
    };
    pollInterval = setInterval(checkHttpReady, 250);
    pollInterval.unref?.();
    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            const isError = trimmed.includes('Error') || trimmed.includes('Failed') || trimmed.includes('EADDRINUSE');
            if (isError)
                log('ERROR', '[server] child emitted an error; details withheld');
            if (!serverReady && !isError && (trimmed.includes('started server on') ||
                trimmed.includes('Listening on') ||
                trimmed.includes('Ready in') ||
                trimmed.includes(`0.0.0.0:${activePort}`) ||
                trimmed.includes(`localhost:${activePort}`) ||
                trimmed.includes(`127.0.0.1:${activePort}`))) {
                markReady('stdout match');
            }
            if (trimmed.includes('EADDRINUSE')) {
                log('ERROR', 'Port', activePort, 'already in use');
                clearTimeout(timeoutHandle);
                if (pollInterval)
                    clearInterval(pollInterval);
                readyReject?.(new Error('EADDRINUSE'));
                terminateNextServer();
            }
        }
    };
    serverProc.stdout?.on('data', onData);
    serverProc.stderr?.on('data', onData);
    serverProc.on('exit', (code, signal) => {
        log(code === 0 ? 'INFO' : 'ERROR', 'Next.js server exited — code:', code, 'signal:', signal);
        clearTimeout(timeoutHandle);
        if (pollInterval)
            clearInterval(pollInterval);
        if (!serverReady) {
            readyReject?.(new Error(`Server exited with code ${code} before becoming ready`));
        }
        serverProc = null;
        try {
            unlinkSync(pidFile);
        }
        catch { /* ignore */ }
    });
}
export function terminateNextServer() {
    if (!serverProc)
        return;
    log('INFO', 'Terminating Next.js server process');
    try {
        serverProc.kill('SIGTERM');
    }
    catch { /* already dead */ }
    serverProc = null;
}
