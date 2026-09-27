// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Central Policy / Permission Engine
//
// Every agent tool call passes through `evaluatePolicy` before execution. The
// engine combines:
//   • mode capabilities    (what the mode allows in principle)
//   • tool declarations    (what each tool demands: perms, confirm, write…)
//   • dynamic state        (limits consumed, confirmations, root validity)
//
// FAIL CLOSED: if permission information is missing, ambiguous or unavailable,
// the decision is DENY. There is no code path that grants a permission that was
// not explicitly declared, and no default-allow anywhere in this module.
// ─────────────────────────────────────────────────────────────────────────────

import { PathSandboxError, checkPath } from "./path-sandbox";
import { classifyCommand } from "./command-policy";
import type { AgentMode, ToolCategory } from "../core/types";

// ── Permission model ─────────────────────────────────────────────────────────

export type AgentPermission =
    | "read_project_files"        // allowed, except sensitive files
    | "write_project_files"       // only inside project scope
    | "delete_files"              // confirmation required
    | "terminal_safe"             // allowed
    | "terminal_restricted"       // confirmation required
    | "terminal_destructive"      // blocked by default
    | "git_status_diff_log"       // allowed
    | "git_commit"                // confirmation required
    | "git_push"                  // blocked by default
    | "deployment"                // blocked by default
    | "network_access"            // only explicitly approved domains/tools
    | "production_access"         // blocked
    | "external_filesystem"       // blocked
    | "memory_read"               // allowed
    | "memory_write";             // allowed (sanitized)

/** Static capability matrix per mode. Deliberately explicit, not additive magic. */
export const MODE_PERMISSIONS: Record<AgentMode, readonly AgentPermission[]> = {
    ask: [
        "read_project_files",
        "terminal_safe",
        "git_status_diff_log",
        "memory_read",
    ],
    assist: [
        "read_project_files",
        "write_project_files",
        "terminal_safe",
        "git_status_diff_log",
        "memory_read",
        "memory_write",
    ],
    engineer: [
        "read_project_files",
        "write_project_files",
        "delete_files",
        "terminal_safe",
        "terminal_restricted",
        "git_status_diff_log",
        "git_commit",
        "memory_read",
        "memory_write",
    ],
    autonomous: [
        "read_project_files",
        "write_project_files",
        "delete_files",
        "terminal_safe",
        "terminal_restricted",
        "git_status_diff_log",
        "git_commit",
        "memory_read",
        "memory_write",
    ],
};

/**
 * Permissions that are structurally blocked at the policy layer for EVERY
 * mode — no mode, confirmation, or UI toggle can grant them. The only way to
 * perform these actions is for a human to do them outside the agent.
 */
export const STRUCTURALLY_BLOCKED: readonly AgentPermission[] = [
    "terminal_destructive",
    "git_push",
    "deployment",
    "production_access",
    "external_filesystem",
];

// ── Tool declarations ────────────────────────────────────────────────────────

export interface ToolPolicyDeclaration {
    /** Permissions the tool requires (ALL of them must be granted). */
    requires: readonly AgentPermission[];
    /** True when a human confirmation token is mandatory even if permitted. */
    requiresConfirmation: boolean;
    /** Tool category — used for limit accounting and UI grouping. */
    category: ToolCategory;
    /** When true the tool can mutate the repo (drives diff-first accounting). */
    mutating: boolean;
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type PolicyDecision =
    | { allowed: true; needsConfirmation: false }
    | { allowed: true; needsConfirmation: true; confirmCode: string }
    | { allowed: false; reason: string; code: string };

// ── Dynamic state the engine needs per call ──────────────────────────────────

export interface PolicyState {
    mode: AgentMode;
    /** Project root verified and available? */
    rootVerified: boolean;
    /** Confirmation tokens already granted for this run (from approval layer). */
    grantedConfirmations: ReadonlySet<string>;
    /** Permission overrides recorded for this run (extra grants from explicit user consent). */
    permissionOverrides?: ReadonlySet<AgentPermission>;
}

export interface PolicyInput {
    toolId: string;
    declaration: ToolPolicyDeclaration;
    state: PolicyState;
    /** Structured arguments, used for path/command pre-checks. */
    args: Record<string, unknown>;
}

/**
 * Central policy evaluation. Throws nothing; returns a decision. Callers MUST
 * treat `allowed: false` as terminal for that tool call.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
    const { toolId, declaration, state, args } = input;

    if (!toolId || !declaration) {
        return { allowed: false, code: "policy_missing_declaration", reason: "Tool is not registered with the policy layer (fail closed)." };
    }

    // 1. Structural blocks — cannot be overridden by mode or confirmation.
    for (const perm of declaration.requires) {
        if (STRUCTURALLY_BLOCKED.includes(perm)) {
            return {
                allowed: false,
                code: "structurally_blocked",
                reason: `Permission "${perm}" is structurally blocked for the AlgoVault agent (all modes).`,
            };
        }
    }

    // 2. Fail closed when the project root cannot be verified and the tool
    //    touches files or runs commands.
    const touchesWorkspace =
        declaration.category === "filesystem" ||
        declaration.category === "git" ||
        declaration.category === "terminal" ||
        declaration.category === "tests";
    if (touchesWorkspace && !state.rootVerified) {
        return {
            allowed: false,
            code: "project_root_unverified",
            reason: "Project root could not be verified — workspace operations are denied (fail closed).",
        };
    }

    // 3. Mode capability check — every required permission must be enabled for
    //    the current mode OR explicitly overridden by a recorded user grant.
    const modePerms = MODE_PERMISSIONS[state.mode] ?? [];
    const overrides = state.permissionOverrides ?? new Set<AgentPermission>();
    const missing: AgentPermission[] = [];
    for (const perm of declaration.requires) {
        if (!modePerms.includes(perm) && !overrides.has(perm)) {
            missing.push(perm);
        }
    }
    if (missing.length > 0) {
        return {
            allowed: false,
            code: "mode_lacks_permission",
            reason: `Mode "${state.mode}" does not grant: ${missing.join(", ")}. Switch modes or provide explicit consent.`,
        };
    }

    // 4. Confirmation requirements.
    if (declaration.requiresConfirmation) {
        // The confirm code identifies WHAT is being confirmed, so a token for
        // "git commit" cannot be replayed to authorize a file delete.
        const confirmCode = confirmationCodeFor(toolId, args);
        if (!state.grantedConfirmations.has(confirmCode)) {
            return { allowed: true, needsConfirmation: true, confirmCode };
        }
    }

    return { allowed: true, needsConfirmation: false };
}

/**
 * Deterministic confirmation identity: the confirmation that is recorded must
 * correspond to the same tool + target, not just "some confirmation happened".
 */
export function confirmationCodeFor(toolId: string, args: Record<string, unknown>): string {
    switch (toolId) {
        case "git.commit":
            return `git.commit:${typeof args.message === "string" ? args.message.slice(0, 120) : ""}`;
        case "fs.delete":
            return `fs.delete:${typeof args.path === "string" ? args.path : ""}`;
        case "fs.rename":
            return `fs.rename:${typeof args.from === "string" ? args.from : ""}->${typeof args.to === "string" ? args.to : ""}`;
        case "terminal.run": {
            // Confirmation is per exact command string.
            return `terminal.run:${typeof args.command === "string" ? args.command : ""}`;
        }
        case "tests.run": {
            return `tests.run:${typeof args.command === "string" ? args.command : ""}`;
        }
        default:
            return `${toolId}:*`;
    }
}

// ── Path/Command pre-flight helpers shared by tools ──────────────────────────

/**
 * Validate a filesystem-ish argument against the sandbox. Returns a deny
 * decision when the path fails, so tools can short-circuit before side effects.
 */
export function policyCheckPath(
    inputPath: unknown,
    opts?: { forWrite?: boolean },
): { ok: true; relPath: string; absPath: string } | { ok: false; reason: string } {
    if (typeof inputPath !== "string") {
        return { ok: false, reason: "Path argument must be a string." };
    }
    const check = checkPath(inputPath, opts);
    if (!check.allowed) {
        return { ok: false, reason: check.message };
    }
    return { ok: true, relPath: check.relPath, absPath: check.absPath };
}

/**
 * Validate a terminal command through the classifier. Blocked → deny.
 * Restricted → allowed only with a matching confirmation (checked by the caller
 * via evaluatePolicy's confirmCode), otherwise a confirmation is requested.
 */
export function policyCheckCommand(
    command: unknown,
): { ok: true } | { ok: false; reason: string } | { needsConfirmation: true; reason: string } {
    if (typeof command !== "string" || command.trim() === "") {
        return { ok: false, reason: "Command must be a non-empty string." };
    }
    const verdict = classifyCommand(command);
    if (verdict.cls === "blocked") {
        return { ok: false, reason: `Blocked (${verdict.code}): ${verdict.message}` };
    }
    if (verdict.cls === "restricted") {
        return { needsConfirmation: true, reason: verdict.message };
    }
    return { ok: true };
}

export { PathSandboxError };
export type { AgentMode, ToolCategory };
