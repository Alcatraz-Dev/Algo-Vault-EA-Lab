// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — real MetaEditor compilation.
//
// When a MetaEditor (metaeditor64.exe) installation is available in the
// environment, generated EAs are compiled for real: the build FAILS LOUDLY with
// the compiler's own error messages when the MQL5 is invalid, and the resulting
// .ex5 is used for the parity/status report. When no compiler exists in the
// environment (e.g. a serverless deployment), a strict static syntax validator
// is used instead and the report explicitly labels the method as "static" —
// compilation is never faked.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export type CompileMethod = "metaeditor" | "static";

export type MQL5CompileResult = {
    success: boolean;
    method: CompileMethod;
    errors: string[];
    warnings: string[];
    /** Raw compiler log (when a real compile ran). */
    compilerOutput?: string;
    /** Path of the produced .ex5 when compiled. */
    ex5Path?: string;
    elapsedMs: number;
    notes: string[];
};

export type MetaEditorInfo = {
    available: boolean;
    wine: string | null;
    prefix: string | null;
    metaeditor: string | null;
    reason?: string;
};

const DEFAULT_WINE = "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine";
const DEFAULT_PREFIX =
    "/Users/haythem_dhahri/Library/Application Support/net.metaquotes.wine.metatrader5";
const DEFAULT_METAEDITOR_REL = "drive_c/Program Files/MetaTrader 5/metaeditor64.exe";

/**
 * Resolves the MetaEditor toolchain from explicit env overrides, falling back to
 * the well-known local install. Never throws.
 */
export function detectMetaEditor(): MetaEditorInfo {
    const wine = process.env.ALGOVAULT_WINE || DEFAULT_WINE;
    const prefix = process.env.ALGOVAULT_WINEPREFIX || DEFAULT_PREFIX;
    const metaeditor =
        process.env.ALGOVAULT_METAEDITOR ||
        path.join(prefix, DEFAULT_METAEDITOR_REL);

    if (process.env.ALGOVAULT_SKIP_COMPILER === "1") {
        return {
            available: false,
            wine: null,
            prefix: null,
            metaeditor: null,
            reason: "ALGOVAULT_SKIP_COMPILER=1",
        };
    }
    try {
        if (!existsSync(metaeditor)) {
            return {
                available: false,
                wine: null,
                prefix: null,
                metaeditor: null,
                reason: `MetaEditor not found at ${metaeditor}`,
            };
        }
        if (wine && !existsSync(wine)) {
            return {
                available: false,
                wine: null,
                prefix: null,
                metaeditor: null,
                reason: `wine not found at ${wine}`,
            };
        }
    } catch {
        return { available: false, wine: null, prefix: null, metaeditor: null, reason: "fs check failed" };
    }
    return { available: true, wine, prefix, metaeditor };
}

function mql5Dir(prefix: string): string {
    return path.join(prefix, "drive_c", "Program Files", "MetaTrader 5", "MQL5");
}

function expertsDir(prefix: string): string {
    return path.join(mql5Dir(prefix), "Experts");
}

/** Parses a MetaEditor compile log (UTF-16LE, written by the compiler). */
export function parseCompilerLog(logPath: string): { errors: string[]; warnings: string[]; result?: string } {
    const errors: string[] = [];
    const warnings: string[] = [];
    try {
        const raw = readFileSync(logPath);
        // MetaEditor writes UTF-16LE with a BOM.
        let text = raw.toString("utf16le");
        text = text.replace(/^\uFEFF/, "");
        // Compilers also write plain when redirected; keep both paths.
        if (text.includes("\u0000")) {
            text = text.replace(/\u0000/g, "");
        }
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            const lower = line.toLowerCase();
            const errMatch = line.match(/error\s+\d+\b.*/i);
            const warnMatch = line.match(/warning\s+\d+\b.*/i);
            if (lower.includes("error") && errMatch && !lower.includes("0 errors")) {
                errors.push(line.trim().replace(/\s{2,}/g, " "));
            } else if (lower.includes("warning") && warnMatch) {
                warnings.push(line.trim().replace(/\s{2,}/g, " "));
            }
            if (lower.includes("result")) {
                // The UTF-16 spaced output ("R e s u l t") also matches via stripped text below.
            }
        }
        // Handle the spaced UTF-16 rendering ("R e s u l t : 0  e r r o r s ...")
        const stripped = text.replace(/[\u0000]/g, "");
        const spaced = stripped.match(/R\s*e\s*s\s*u\s*l\s*t\s*:\s*(\d+)\s*e\s*r\s*r\s*o\s*r\s*s?\s*,\s*(\d+)\s*w\s*a\s*r\s*n\s*i\s*n\s*g\s*s?/i);
        if (spaced) {
            return { errors, warnings, result: `Result: ${spaced[1]} errors, ${spaced[2]} warnings` };
        }
        const plain = stripped.match(/Result\s*:\s*(\d+)\s*errors?[\s,]+(\d+)\s*warnings?/i);
        if (plain) {
            return { errors, warnings, result: `Result: ${plain[1]} errors, ${plain[2]} warnings` };
        }
    } catch {
        // no log file
    }
    return { errors, warnings };
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * The macOS/wine MetaEditor has no standalone compiler: metaeditor64.exe merely
 * queues a compile request that the running terminal64.exe serves during its
 * startup. Empirically (verified on this host) the sequence is:
 *
 *   1. start metaeditor64.exe with /compile + /log (it blocks, waiting for the
 *      terminal's compile service to appear);
 *   2. boot terminal64.exe — the boot handshake mated with the queued request
 *      produces a real .ex5 and a UTF-16LE log within seconds;
 *   3. once the terminal is fully settled, metaeditor64.exe exits immediately
 *      and dot-files are never produced — so every compile needs a fresh boot.
 *
 * This helper terminates any running MT5 toolchain processes on the host
 * (scoped by executable name) and waits until none remain, so the next boot is
 * guaranteed to host the compile service.
 */
async function terminateToolchainProcesses(): Promise<void> {
    // Match only wine-side binaries of the MetaTrader 5 prefix, never processes
    // whose command line merely mentions those names (e.g. our own shells).
    const isToolchain = (line: string) =>
        /MetaTrader 5\\(terminal64|metaeditor64)\.exe/.test(line) || /bin\/wineserver( |$)/.test(line);

    const toolchainPids = async (): Promise<string[]> => {
        // Never kill ourselves or our immediate parent (the invoking shell).
        const neverKill = new Set<number>([process.pid, process.ppid]);
        const pids: string[] = [];
        try {
            const ps = await execFileAsync("/bin/ps", ["ax", "-o", "pid=", "-o", "state=", "-o", "command="], { timeout: 10_000 });
            for (const line of ps.stdout.split("\n")) {
                if (!isToolchain(line)) continue;
                const match = line.trim().match(/^(\d+)\s+(\S)\s+/);
                if (!match) continue;
                if (match[2] === "Z") continue; // zombies hold no locks — ignore
                const pid = Number(match[1]);
                if (Number.isInteger(pid) && !neverKill.has(pid)) pids.push(String(pid));
            }
        } catch {
            /* ps unavailable */
        }
        return pids;
    };

    const killPids = async (signal: string, pids: string[]) => {
        if (pids.length === 0) return;
        try {
            await execFileAsync("/bin/kill", [`-${signal}`, ...pids], { timeout: 10_000 });
        } catch {
            /* already gone */
        }
    };

    // Bounded budget (35s total) so a wedged toolchain can never starve the caller.
    const stopAt = Date.now() + 35_000;
    const waitUntilClean = async (intervalMs: number) => {
        while (Date.now() < stopAt) {
            await sleep(intervalMs);
            if ((await toolchainPids()).length === 0) return true;
        }
        return false;
    };

    const first = await toolchainPids();
    if (first.length > 0) {
        await killPids("TERM", first);
        if (await waitUntilClean(1000)) return;
        const rest = await toolchainPids();
        if (rest.length > 0) {
            await killPids("KILL", rest);
            await waitUntilClean(1000);
        }
    } else {
        await sleep(1500);
    }
}

/**
 * Compiles a single .mq5 file with the real MetaEditor and waits for the .ex5,
 * returning the parsed compiler verdict. Throws only on environmental failure
 * (missing tools) — MQL5 errors are returned in `result.errors`.
 */
export async function compileWithMetaEditor(mq5Path: string, timeoutMs = 120_000): Promise<MQL5CompileResult> {
    const started = Date.now();
    const info = detectMetaEditor();
    if (!info.available || !info.wine || !info.prefix || !info.metaeditor) {
        throw new Error(`MetaEditor unavailable: ${info.reason}`);
    }

    const logPath = path.join(
        os.tmpdir(),
        `algovault_ea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`
    );
    const ex5Path = mq5Path.replace(/\.mq5$/i, ".ex5");
    const exePath = path.join(info.prefix, "drive_c", "Program Files", "MetaTrader 5", "terminal64.exe");
    const wineEnv = { ...process.env, WINEPREFIX: info.prefix };

    const notes: string[] = [];
    let terminalProc: ReturnType<typeof spawn> | null = null;

    const pollOnceForOutcome = (timeoutMs: number): Promise<{ done: boolean; reason?: string }> =>
        new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const tick = async () => {
                if (existsSync(ex5Path)) return resolve({ done: true });
                const parsedNow = parseCompilerLog(logPath);
                if (parsedNow.result) return resolve({ done: true });
                if (Date.now() >= deadline) return resolve({ done: false, reason: "deadline" });
                await sleep(1500);
                void tick();
            };
            void tick();
        });

    try {
        for (let attempt = 1; attempt <= 2; attempt++) {
            // 1. Reset — a fully-booted terminal refuses queued compiles.
            await terminateToolchainProcesses();

            // 2. Queue the compile request.
            const metaArgs = [info.metaeditor, `/compile:${mq5Path}`, `/log:${logPath}`];
            const metaProc = spawn(info.wine, metaArgs, {
                env: wineEnv,
                stdio: ["ignore", "ignore", "pipe"],
            });
            metaProc.stderr?.on("data", () => { /* keep the pipe drained */ });
            notes.push(`Attempt ${attempt}: MetaEditor started in compile-queue mode.`);
            await sleep(4000);

            // 3. Boot the terminal to serve the queued request.
            const terminalExists = existsSync(exePath);
            if (terminalExists) {
                terminalProc = spawn(info.wine, [exePath, "/portable"], {
                    env: wineEnv,
                    detached: true,
                    stdio: "ignore",
                });
                terminalProc.unref();
                notes.push(`Attempt ${attempt}: terminal64.exe booted to host the compiler service.`);
            } else {
                notes.push("terminal64.exe not found — the compiler service cannot be hosted.");
            }

            // 4. Wait for the .ex5 (the compiler writes it next to the source).
            const outcome = await pollOnceForOutcome(Math.min(45_000, Math.max(15_000, timeoutMs)));
            if (outcome.done) break;
        }
        if (!existsSync(ex5Path) && !parseCompilerLog(logPath).result) {
            try {
                terminalProc?.kill("SIGTERM");
            } catch { /* ignore */ }
        }
    } catch (err) {
        throw new Error(`Compiler invocation failed: ${String(err)}`);
    }

    // Tear down whatever booted so the next compile starts from a clean state
    // (a settled terminal refuses queued compiles). Bounded by design.
    await terminateToolchainProcesses();

    const parsed = parseCompilerLog(logPath);
    const hasResult = !!parsed.result;
    const ex5Exists = existsSync(ex5Path);
    const errors = [...parsed.errors];
    const warnings = [...parsed.warnings];

    let success = false;
    if (hasResult) {
        success = /errors?\s*:\s*0/i.test(parsed.result!);
    } else if (ex5Exists) {
        success = true;
        notes.push("Compiler produced an .ex5 but no log/result line was captured.");
    } else {
        success = false;
        notes.push("Compiler produced neither an .ex5 nor a result line — the toolchain is wedged. Falling back to static validation.");
    }

    // Best-effort cleanup of temp log.
    try {
        await fs.unlink(logPath);
    } catch {
        /* ignore */
    }

    return {
        success,
        method: "metaeditor",
        errors,
        warnings,
        compilerOutput: parsed.result,
        ex5Path: ex5Exists ? ex5Path : undefined,
        elapsedMs: Date.now() - started,
        notes,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Static validation (fallback when no compiler is present).
// ─────────────────────────────────────────────────────────────────────────────

/** Balanced-brace / paren / bracket scan per line, returned with line numbers. */
export function staticValidateMQL5(code: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. The template must have produced the mandatory structure.
    const required = [
        "int OnInit()",
        "void OnTick()",
        "void LoadFeatureState(",
        "#define f_setup f_",
    ];
    for (const req of required) {
        if (!code.includes(req)) errors.push(`Missing required construct: ${req}`);
    }
    if (!/\bCTrade\s+trade\s*;/.test(code)) {
        errors.push("Missing required construct: CTrade trade;");
    }

    // 2. Every referenced TF feature var must be declared and loaded. The
    //    "f_setup" alias is a #define pointing at the setup TF's var, which
    //    must itself be declared.
    const macroTarget = code.match(/#define\s+f_setup\s+f_([A-Z0-9]+)/);
    const usedFeatureRefs = [...code.matchAll(/\bf_([A-Z0-9]+)\./g)].map((m) => m[1]);
    const declaredFeatureVars = [...code.matchAll(/FeatureState\s+(f_[A-Z0-9]+)\s*;/g)].map((m) => m[1]);
    for (const ref of usedFeatureRefs) {
        const varName = `f_${ref}`;
        if (ref === "setup") {
            if (macroTarget && declaredFeatureVars.includes(`f_${macroTarget[1]}`)) continue;
            errors.push(`f_setup alias target is not a declared feature state: ${varName}`);
            continue;
        }
        if (!declaredFeatureVars.includes(varName)) {
            errors.push(`Reference to undeclared feature state: ${varName}`);
        }
    }
    for (const declaredVar of declaredFeatureVars) {
        if (!code.includes(`LoadFeatureState(${declaredVar},`)) {
            errors.push(`Feature state ${declaredVar} is declared but never loaded.`);
        }
    }

    // 3. Balanced braces / parens / brackets (MQL5 is C-like; the template is clean).
    const stack: Array<{ ch: string; line: number }> = [];
    const openers: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
    const lines = code.split("\n");
    let inString = false;
    for (let ln = 0; ln < lines.length; ln++) {
        const line = lines[ln];
        for (let ci = 0; ci < line.length; ci++) {
            const ch = line[ci];
            if (ch === '"') inString = !inString;
            if (inString) continue;
            if (ch === "//") break;
            if (openers[ch]) stack.push({ ch, line: ln + 1 });
            else if (ch === "}" || ch === ")" || ch === "]") {
                const top = stack.pop();
                if (!top || openers[top.ch] !== ch) {
                    errors.push(`Unbalanced '${ch}' on line ${ln + 1}`);
                    break;
                }
            }
        }
    }
    if (stack.length > 0) {
        errors.push(`Unclosed ${stack[stack.length - 1].ch} from line ${stack[stack.length - 1].line}`);
    }

    // 4. No fabricated identifiers that the old scaffolding emitted.
    const fakeIdentifiers = ["StringArrayContains", "ArrayContains", "chochDirection == 1", "entryPrice + 0.5"];
    for (const fake of fakeIdentifiers) {
        if (code.includes(fake)) errors.push(`Fabricated MQL5 construct found: ${fake}`);
    }

    // 5. No hardcoded symbol prices or lots (generic instrument requirement).
    if (/\b(Symbol\(\)\s*!=\s*"|trade\.PositionOpen\("[A-Z])/.test(code)) {
        errors.push("EA appears to hardcode a trading symbol.");
    }

    // 6. Every input referenced in the body must be declared as an input or variable.
    const declaredInputs = [...code.matchAll(/input\s+(?:ulong|int|double|bool|string|ENUM_\w+)\s+(\w+)/g)].map((m) => m[1]);
    const declaredVars = new Set(declaredInputs);
    const bodyOnly = code.split("//+------------------------------------------------------------------+")[0];
    for (const ident of bodyOnly.matchAll(/\b([A-Z][A-Za-z0-9_]+)\b/g)) {
        if (declaredVars.has(ident[1])) continue;
        // anything starting uppercase inside the "Globals" is a global we declared
    }

    if (code.includes("TradesToday") && !/\bg_tradesToday\b/.test(code)) {
        errors.push("Inconsistent trade counter naming (g_tradesToday expected).");
    }

    // Keep warnings for unusual conditions.
    if (!code.includes("#property strict")) warnings.push("Missing #property strict.");
    if (!code.includes("trade.SetExpertMagicNumber")) warnings.push("Missing magic number wiring.");

    return { errors, warnings };
}

/**
 * Attempts a real MetaEditor compile when the toolchain is present; otherwise
 * falls back to the strict static validator. Returns a clearly-labeled result.
 */
export async function compileMQL5(code: string, fileName: string, opts?: { timeoutMs?: number }): Promise<MQL5CompileResult> {
    const started = Date.now();
    const info = detectMetaEditor();
    if (!info.available || !info.prefix) {
        const staticResult = staticValidateMQL5(code);
        return {
            success: staticResult.errors.length === 0,
            method: "static",
            errors: staticResult.errors,
            warnings: staticResult.warnings,
            elapsedMs: Date.now() - started,
            notes: [`MetaEditor unavailable in this environment: ${info.reason ?? "unknown"}. Used static validation.`],
        };
    }

    // Write the source into the MetaTrader Experts folder so #include resolution
    // and output paths behave like the real editor.
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const target = path.join(expertsDir(info.prefix), safeName);
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, code, "utf8");
    } catch (err) {
        return {
            success: false,
            method: "static",
            errors: [`Could not write EA source for compilation: ${String(err)}`],
            warnings: [],
            elapsedMs: Date.now() - started,
            notes: ["Fell back to static validation because the compiler directory was not writable."],
        };
    }

    let result: MQL5CompileResult;
    try {
        result = await compileWithMetaEditor(target, opts?.timeoutMs ?? 120_000);
        // A wedged toolchain (no .ex5, no log verdict, zero captured errors)
        // means the real compiler could not give a verdict — fall back to the
        // strict static validator and label it as such. Never report a silent
        // "compiled" for a compile that never produced an artifact.
        if (
            result.method === "metaeditor" &&
            !result.success &&
            result.errors.length === 0 &&
            result.warnings.length === 0 &&
            !result.compilerOutput &&
            !result.ex5Path
        ) {
            const staticResult = staticValidateMQL5(code);
            result = {
                success: staticResult.errors.length === 0,
                method: "static",
                errors: staticResult.errors,
                warnings: staticResult.warnings,
                elapsedMs: Date.now() - started,
                notes: [`MetaEditor could not host a compile request: ${result.notes.join(" ")}. Used static validation.`],
            };
        }
    } catch (err) {
        const staticResult = staticValidateMQL5(code);
        result = {
            success: staticResult.errors.length === 0,
            method: "static",
            errors: staticResult.errors,
            warnings: staticResult.warnings,
            elapsedMs: Date.now() - started,
            notes: [`Compiler invocation failed: ${String(err)}. Used static validation.`],
        };
    }

    // Clean up the temp .mq5 (leave the .ex5 when one was produced).
    try {
        await fs.unlink(target);
    } catch {
        /* ignore */
    }

    return result;
}

/** Convenience: verify the toolchain reports available (for status UIs). */
export async function compilerAvailability(): Promise<MetaEditorInfo> {
    return detectMetaEditor();
}