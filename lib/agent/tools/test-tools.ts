// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Test Tooling
//
// Wraps the repository's canonical validation commands (jiti test runners,
// tsc --noEmit, eslint, next build) in the bounded, classified terminal
// executor. These are the "targeted tests" / "broader validation" the
// lifecycle runs after edits. Commands are classified like any other; the
// runner is just a convenience facade over the same policy path.
// ─────────────────────────────────Which-commands-are-wired────────────────────
//   typecheck  → npx tsc --noEmit
//   lint       → npx eslint (full) — scoped lint is not project-canonical
//   suite:<s>  → node scripts/jiti-tsrun.mjs <runner>   (known suites only)
//   build      → npm run build (restricted → needs confirmation, slower)
// ─────────────────────────────────────────────────────────────────────────────

import { classifyCommand } from "../policies/command-policy";
import { runBoundedCommand, formatCommandOutput } from "./terminal-tools";
import type { ToolResult } from "../core/types";
import { defineTool } from "../core/types";

/** Known test runners (repo-canonical). Keys are the suite names the agent may target. */
const KNOWN_SUITES: Record<string, string> = {
    ai: "lib/ai/__tests__/run-ai-tests.ts",
    agents: "lib/agents/__tests__/run-agents-tests.ts",
    risk: "lib/risk/tests/run-tests.ts",
    workflows: "lib/workflows/__tests__/run-workflow-tests.ts",
    agentIde: "lib/agent/__tests__/run-agent-ide-tests.ts",
};

function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}

/** Build the exact command for a validation target. Returns null when unknown. */
export function commandForTarget(target: string): string | null {
    if (target === "typecheck") return "npx tsc --noEmit";
    if (target === "lint") return "npx eslint .";
    if (target === "build") return "npm run build";
    if (target.startsWith("suite:")) {
        const suite = target.slice("suite:".length);
        const runner = KNOWN_SUITES[suite];
        if (!runner) return null;
        return `node scripts/jiti-tsrun.mjs ${runner}`;
    }
    return null;
}

export function knownSuiteNames(): string[] {
    return ["typecheck", "lint", "build", ...Object.keys(KNOWN_SUITES).map((s) => `suite:${s}`)];
}

/**
 * Run one validation target. Classification applies as everywhere else:
 * typecheck/lint/suites are allowlisted safe; build is allowlisted safe too
 * but slower, so it gets a longer timeout by default.
 */
export const testsRunTool = defineTool(
    {
        id: "tests.run",
        description: "Run a known validation target: typecheck, lint, build, or suite:<name> (ai, agents, risk, workflows, agentIde).",
        category: "tests",
        argsHint: "{ target: string, timeoutMs?: number }",
    },
    async (args, ctx) => {
        const target = typeof args.target === "string" ? args.target.trim() : "";
        if (target === "") return fail("target is required", "invalid_args");

        const command = commandForTarget(target);
        if (command === null) {
            return fail(`Unknown target "${target}". Valid: ${knownSuiteNames().join(", ")}`, "invalid_args");
        }

        if (ctx.limits.terminalCommands >= ctx.limits.limits.maxTerminalCommands) {
            return fail("Terminal command limit reached for this run.", "limit_reached");
        }

        const verdict = classifyCommand(command);
        if (verdict.cls !== "safe") {
            // Defensive: the allowlist above must keep these safe; fail closed otherwise.
            return fail(`Refusing: command classified as ${verdict.cls} (${verdict.code}).`, "policy_denied");
        }

        ctx.limits.terminalCommands += 1;
        ctx.emit({
            seq: 0, runId: ctx.runId, type: "tests_started",
            message: `Running ${target}…`,
            at: Date.now(),
        });

        const timeoutMs = typeof args.timeoutMs === "number"
            ? args.timeoutMs
            : target === "build"
              ? 300_000
              : target === "lint"
                ? 240_000
                : 180_000;

        const res = await runBoundedCommand(command, { timeoutMs, signal: ctx.signal });
        const output = formatCommandOutput(res);
        const passed = res.code === 0 && !res.timedOut && !res.cancelled;

        ctx.emit({
            seq: 0, runId: ctx.runId, type: "tests_result",
            message: `${target}: ${passed ? "PASSED" : "FAILED"} (${res.durationMs}ms)`,
            at: Date.now(),
            data: { target, passed },
        });

        return {
            ok: passed,
            output,
            data: { target, passed, exitCode: res.code, durationMs: res.durationMs },
            error: passed ? undefined : `${target} failed (exit ${res.code}).`,
            code: passed ? undefined : "validation_failed",
            durationMs: res.durationMs,
        };
    },
);
