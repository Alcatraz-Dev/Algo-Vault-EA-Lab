// AlgoVault Agent IDE — Tool Registry & Router
//
// The single choke point for agent tool execution. Every call flows:
//   registry.execute(toolId, args, ctx, policyState)
//     → evaluatePolicy (mode caps, structural blocks, confirmations)
//     → global limit check
//     → tool.execute (itself sandboxed)
//     → event emission + changed-file accounting for mutating tools
//
// There is NO path to a tool that skips evaluatePolicy: the runtime holds only
// the registry, and each tool independently enforces the sandbox again.

import type { AgentTool, ToolExecutionContext, ToolResult } from "../core/types";
import type { ToolPolicyDeclaration, PolicyState } from "../policies/permission-engine";
import { evaluatePolicy } from "../policies/permission-engine";
import { isLimitReached } from "../core/types";
import { redactErrorForLog, redactSecrets } from "../policies/redaction";

/** Hard cap for any tool output that leaves the registry (model/UI/logs). */
const MAX_TOOL_OUTPUT_CHARS = 24_000;

/**
 * Central output hygiene: EVERY tool result passes through here before it can
 * reach the model, the UI or the event log — redaction is not left to
 * individual tools to remember.
 */
function sanitizeToolResult(result: ToolResult): ToolResult {
    const clean = (text: string): string => {
        const capped = text.length > MAX_TOOL_OUTPUT_CHARS
            ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… [output truncated]`
            : text;
        return redactSecrets(capped);
    };
    return {
        ...result,
        output: typeof result.output === "string" ? clean(result.output) : result.output,
        error: typeof result.error === "string" ? redactSecrets(result.error.slice(0, 500)) : result.error,
    };
}

import {
    fsSearchTool, fsReadTool, fsWriteTool, fsEditTool, fsRenameTool, fsDeleteTool,
} from "./fs-tools";
import {
    gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool,
} from "./git-tools";
import { terminalRunTool } from "./terminal-tools";
import { testsRunTool } from "./test-tools";
import {
    memoryWriteTool, memoryListTool, memorySearchTool, memoryDeleteTool,
    docsSearchTool, profileGetTool,
} from "./knowledge-tools";

// Declarations: what each tool requires from the policy layer.

export const TOOL_DECLARATIONS: Record<string, ToolPolicyDeclaration> = {
    "fs.search":     { requires: ["read_project_files"], requiresConfirmation: false, category: "filesystem", mutating: false },
    "fs.read":       { requires: ["read_project_files"], requiresConfirmation: false, category: "filesystem", mutating: false },
    "fs.write":      { requires: ["write_project_files"], requiresConfirmation: false, category: "filesystem", mutating: true },
    "fs.edit":       { requires: ["write_project_files"], requiresConfirmation: false, category: "filesystem", mutating: true },
    "fs.rename":     { requires: ["write_project_files"], requiresConfirmation: true, category: "filesystem", mutating: true },
    "fs.delete":     { requires: ["write_project_files", "delete_files"], requiresConfirmation: true, category: "filesystem", mutating: true },
    "git.status":    { requires: ["git_status_diff_log"], requiresConfirmation: false, category: "git", mutating: false },
    "git.diff":      { requires: ["git_status_diff_log"], requiresConfirmation: false, category: "git", mutating: false },
    "git.log":       { requires: ["git_status_diff_log"], requiresConfirmation: false, category: "git", mutating: false },
    "git.branch":    { requires: ["git_status_diff_log"], requiresConfirmation: false, category: "git", mutating: false },
    "git.commit":    { requires: ["git_commit"], requiresConfirmation: true, category: "git", mutating: true },
    "terminal.run":  { requires: ["terminal_safe"], requiresConfirmation: false, category: "terminal", mutating: false },
    "tests.run":     { requires: ["terminal_safe"], requiresConfirmation: false, category: "tests", mutating: false },
    "memory.write":  { requires: ["memory_write"], requiresConfirmation: false, category: "memory", mutating: false },
    "memory.list":   { requires: ["memory_read"], requiresConfirmation: false, category: "memory", mutating: false },
    "memory.search": { requires: ["memory_read"], requiresConfirmation: false, category: "memory", mutating: false },
    "memory.delete": { requires: ["memory_write"], requiresConfirmation: true, category: "memory", mutating: false },
    "docs.search":   { requires: ["read_project_files"], requiresConfirmation: false, category: "knowledge", mutating: false },
    "profile.get":   { requires: ["read_project_files"], requiresConfirmation: false, category: "knowledge", mutating: false },
};

interface RegistryEntry {
    tool: AgentTool;
    declaration: ToolPolicyDeclaration;
}

let eventSeqCounter = 0;
function nextSeq(): number {
    eventSeqCounter += 1;
    return eventSeqCounter;
}

export class AgentToolRegistry {
    private tools = new Map<string, RegistryEntry>();

    register(tool: AgentTool, declaration: ToolPolicyDeclaration): void {
        this.tools.set(tool.id, { tool, declaration });
    }

    list(): AgentTool[] {
        return [...this.tools.values()].map((e) => e.tool);
    }

    has(toolId: string): boolean {
        return this.tools.has(toolId);
    }

    getDeclaration(toolId: string): ToolPolicyDeclaration | null {
        return this.tools.get(toolId)?.declaration ?? null;
    }

    /**
     * Central execution path. Production callers MUST go through here; tests
     * may call tools directly to verify their own sandboxing.
     */
    async execute(
        toolId: string,
        args: Record<string, unknown>,
        ctx: ToolExecutionContext,
        policyState: PolicyState,
    ): Promise<ToolResult> {
        const entry = this.tools.get(toolId);
        if (!entry) {
            return { ok: false, error: `Unknown tool "${toolId}".`, code: "unknown_tool" };
        }

        // Global limits.
        const limitCheck = isLimitReached(ctx.limits);
        if (limitCheck.reached) {
            ctx.emit({
                seq: nextSeq(),
                runId: ctx.runId,
                type: "limit_reached",
                message: `Run limit reached (${limitCheck.which}) — stopping safely.`,
                at: Date.now(),
            });
            return { ok: false, error: `Run limit reached (${limitCheck.which}).`, code: "limit_reached" };
        }

        // Policy gate.
        const decision = evaluatePolicy({ toolId, declaration: entry.declaration, state: policyState, args });
        if (!decision.allowed) {
            ctx.emit({
                seq: nextSeq(),
                runId: ctx.runId,
                type: "tool_denied",
                message: `Tool "${toolId}" denied: ${decision.reason}`,
                at: Date.now(),
                data: { toolId, code: decision.code },
            });
            return { ok: false, error: decision.reason, code: "policy_denied" };
        }

        if (decision.needsConfirmation) {
            return {
                ok: false,
                code: "confirmation_required",
                error: `Confirmation required for ${toolId}.`,
                data: { confirmCode: decision.confirmCode },
            };
        }

        // Execute.
        const startedAt = Date.now();
        try {
            const result = sanitizeToolResult(await entry.tool.execute(args, ctx));
            const durationMs = Date.now() - startedAt;

            // Mutating tools that succeeded count toward the changed-file budget.
            if (entry.declaration.mutating && result.ok) {
                const touched = extractTouchedPaths(toolId, args);
                let added = false;
                for (const p of touched) {
                    if (!ctx.limits.filesChanged.includes(p)) {
                        ctx.limits.filesChanged.push(p);
                        added = true;
                    }
                }
                if (added) {
                    ctx.emit({
                        seq: nextSeq(),
                        runId: ctx.runId,
                        type: "files_changed",
                        message: `Modified ${ctx.limits.filesChanged.length} file(s).`,
                        at: Date.now(),
                        data: { files: [...ctx.limits.filesChanged] },
                    });
                }
            }

            return { ...result, durationMs: result.durationMs ?? durationMs };
        } catch (err) {
            return { ok: false, error: redactErrorForLog(err), code: "tool_crashed" };
        }
    }
}

function extractTouchedPaths(toolId: string, args: Record<string, unknown>): string[] {
    const one = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? [v] : []);
    switch (toolId) {
        case "fs.write":
        case "fs.edit":
        case "fs.delete":
            return one(args.path);
        case "fs.rename":
            return [...one(args.from), ...one(args.to)];
        case "git.commit": {
            const paths = Array.isArray(args.paths)
                ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "")
                : [];
            return paths;
        }
        default:
            return [];
    }
}

// Registry factory used by the runtime and API routes.
export function createDefaultRegistry(): AgentToolRegistry {
    const registry = new AgentToolRegistry();
    const byId: Array<[AgentTool, ToolPolicyDeclaration | undefined]> = [
        [fsSearchTool, TOOL_DECLARATIONS["fs.search"]],
        [fsReadTool, TOOL_DECLARATIONS["fs.read"]],
        [fsWriteTool, TOOL_DECLARATIONS["fs.write"]],
        [fsEditTool, TOOL_DECLARATIONS["fs.edit"]],
        [fsRenameTool, TOOL_DECLARATIONS["fs.rename"]],
        [fsDeleteTool, TOOL_DECLARATIONS["fs.delete"]],
        [gitStatusTool, TOOL_DECLARATIONS["git.status"]],
        [gitDiffTool, TOOL_DECLARATIONS["git.diff"]],
        [gitLogTool, TOOL_DECLARATIONS["git.log"]],
        [gitBranchTool, TOOL_DECLARATIONS["git.branch"]],
        [gitCommitTool, TOOL_DECLARATIONS["git.commit"]],
        [terminalRunTool, TOOL_DECLARATIONS["terminal.run"]],
        [testsRunTool, TOOL_DECLARATIONS["tests.run"]],
        [memoryWriteTool, TOOL_DECLARATIONS["memory.write"]],
        [memoryListTool, TOOL_DECLARATIONS["memory.list"]],
        [memorySearchTool, TOOL_DECLARATIONS["memory.search"]],
        [memoryDeleteTool, TOOL_DECLARATIONS["memory.delete"]],
        [docsSearchTool, TOOL_DECLARATIONS["docs.search"]],
        [profileGetTool, TOOL_DECLARATIONS["profile.get"]],
    ];
    for (const [tool, declaration] of byId) {
        if (tool && declaration) {
            registry.register(tool, declaration);
        }
    }
    return registry;
}
