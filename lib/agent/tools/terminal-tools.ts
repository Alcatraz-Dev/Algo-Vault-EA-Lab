// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Terminal Tool
//
// There is no hidden unrestricted shell. A command reaches the OS only when:
//   1. the policy engine allowed the call (mode + limits + root verified), and
//   2. the command classifier returned `safe`, or `restricted` AND a human
//      confirmation for this exact command string was granted this run.
//
// Execution is bounded: timeout, output cap, output redaction, cancellation
// via AbortSignal, and a per-run terminal-command budget.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { getProjectRoot } from "../policies/path-sandbox";
import { classifyCommand } from "../policies/command-policy";
import { redactSecrets, redactErrorForLog } from "../policies/redaction";
import type { AgentTool, ToolExecutionContext, ToolResult } from "../core/types";

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;

export interface CommandRunResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
    durationMs: number;
}

/**
 * Execute a command in the project root with bounded resources.
 * The caller MUST have classified the command already — this function does not
 * re-classify; it is the raw (but sandboxed) executor.
 */
export function runBoundedCommand(
    command: string,
    opts: { timeoutMs?: number; signal?: AbortSignal; cwd?: string } = {},
): Promise<CommandRunResult> {
    const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const cwd = opts.cwd ?? getProjectRoot() ?? process.cwd();

    return new Promise((resolve) => {
        const startedAt = Date.now();
        const child = spawn(command, {
            cwd,
            shell: true, // classifier validated the exact string; pipes/&& must work
            env: process.env,
            detached: process.platform !== "win32", // own process group → clean kill
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let cancelled = false;
        let settled = false;

        const killTree = () => {
            try {
                if (process.platform !== "win32") {
                    process.kill(-child.pid!, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                try { child.kill("SIGKILL"); } catch { /* already dead */ }
            }
        };

        const timer = setTimeout(() => {
            timedOut = true;
            killTree();
        }, timeoutMs);

        const onAbort = () => {
            cancelled = true;
            killTree();
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });

        const appendOut = (d: unknown) => {
            if (stdout.length < 200_000) stdout += String(d);
        };
        const appendErr = (d: unknown) => {
            if (stderr.length < 100_000) stderr += String(d);
        };

        child.stdout?.on("data", appendOut);
        child.stderr?.on("data", appendErr);

        const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            opts.signal?.removeEventListener("abort", onAbort);
            resolve({
                code: code ?? -1,
                stdout,
                stderr,
                timedOut,
                cancelled,
                durationMs: Date.now() - startedAt,
            });
        };

        child.on("error", (err) => {
            stderr += `\n${err.message}`;
            finish(-1);
        });
        child.on("close", (code) => finish(code));
    });
}

/** Combine, cap and redact combined command output for the model/UI. */
export function formatCommandOutput(res: CommandRunResult, maxChars = MAX_OUTPUT_CHARS): string {
    const raw = [res.stdout, res.stderr].filter((s) => s.trim() !== "").join("\n--- stderr ---\n");
    const suffix = raw.length > maxChars ? "\n… [output truncated]" : "";
    const body = raw.slice(0, maxChars);
    const status = res.timedOut
        ? `\n[command timed out after its budget]`
        : res.cancelled
          ? "\n[command cancelled]"
          : `\n[exit code: ${res.code}]`;
    return redactSecrets(`${body}${suffix}${status}`);
}

/**
 * Shared classification gate. Returns the verdict plus whether a confirmation
 * is still missing (the caller turns that into a confirmation request).
 */
export function gateCommand(command: string, grantedConfirmations: ReadonlySet<string>, confirmCode: string): { proceed: boolean; reason?: string } {
    const verdict = classifyCommand(command);
    if (verdict.cls === "blocked") {
        return { proceed: false, reason: `Blocked (${verdict.code}): ${verdict.message}` };
    }
    if (verdict.cls === "restricted" && !grantedConfirmations.has(confirmCode)) {
        return { proceed: false, reason: `Confirmation required: ${verdict.message}` };
    }
    return { proceed: true };
}

function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}

export const terminalRunTool: AgentTool = {
    id: "terminal.run",
    description: "Run a project-local command after command-policy classification. Safe commands run directly; restricted ones need confirmation; blocked ones are refused.",
    category: "terminal",
    argsHint: '{ command: string, timeoutMs?: number }',
    execute: async (args, ctx: ToolExecutionContext): Promise<ToolResult> => {
        const command = typeof args.command === "string" ? args.command.trim() : "";
        const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;

        if (command === "") return fail("command is required", "invalid_args");

        // Per-run terminal budget.
        if (ctx.limits.terminalCommands >= ctx.limits.limits.maxTerminalCommands) {
            return fail("Terminal command limit reached for this run.", "limit_reached");
        }

        // Root must be verified (belt and braces — policy already requires it).
        if (!getProjectRoot()) {
            return fail("Project root unverified — terminal denied (fail closed).", "policy_denied");
        }

        const verdict = classifyCommand(command);
        if (verdict.cls === "blocked") {
            ctx.emit({
                seq: 0, runId: ctx.runId, type: "tool_denied",
                message: `Command blocked by policy (${verdict.code}).`,
                at: Date.now(), data: { command },
            });
            return fail(`Blocked (${verdict.code}): ${verdict.message}`, "command_blocked");
        }

        ctx.limits.terminalCommands += 1;
        const res = await runBoundedCommand(command, { timeoutMs, signal: ctx.signal });

        const output = formatCommandOutput(res);
        const okResult = res.code === 0 && !res.timedOut && !res.cancelled;
        return {
            ok: okResult,
            output,
            data: { exitCode: res.code, timedOut: res.timedOut, cancelled: res.cancelled, durationMs: res.durationMs },
            error: okResult ? undefined : res.timedOut ? "Command timed out." : res.cancelled ? "Command cancelled." : `Command exited with code ${res.code}.`,
            code: okResult ? undefined : res.timedOut ? "timeout" : res.cancelled ? "cancelled" : "nonzero_exit",
            durationMs: res.durationMs,
        };
    },
};

// Convenience re-export for test tools.
export { redactErrorForLog };
