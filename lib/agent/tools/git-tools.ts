// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Git Tools
//
// Read-only inspection is freely allowed. Commit is confirmation-gated. Push,
// force flags and history rewrite (reset/rebase/clean) are structurally refused
// — they are not in the tool surface at all, so no policy misconfiguration can
// expose them. Pre-existing user changes are captured before the agent runs so
// agent-generated changes are always distinguishable from user work.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { getProjectRoot } from "../policies/path-sandbox";
import { policyCheckPath } from "../policies/permission-engine";
import { redactSecrets } from "../policies/redaction";
import type { ToolResult } from "../core/types";
import { defineTool } from "../core/types";

const MAX_OUTPUT_CHARS = 24_000;
const GIT_TIMEOUT_MS = 15_000;

function ok(data?: unknown, output?: string): ToolResult {
    return { ok: true, data, output };
}
function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}
function cap(text: string): string {
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [output truncated]` : text;
}
function capAndRedact(text: string): string {
    return redactSecrets(cap(text));
}

/**
 * Run a git command with an argv array (no shell → no injection).
 * Never throws; timeouts and output caps are enforced.
 */
export function runGit(args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const cwd = getProjectRoot() ?? process.cwd();
        const child = spawn("git", args, {
            cwd,
            shell: false,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout?.on("data", (d) => {
            stdout += String(d);
            if (stdout.length > 200_000) child.kill("SIGKILL");
        });
        child.stderr?.on("data", (d) => {
            stderr += String(d);
            if (stderr.length > 50_000) child.kill("SIGKILL");
        });
        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` });
        });
        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

// ── Shared inspection used by tools AND the runtime ──────────────────────────

export interface GitStateSnapshot {
    available: boolean;
    branch: string | null;
    entries: Array<{ status: string; path: string; origPath?: string }>;
    untrackedCount: number;
    modifiedCount: number;
    ahead: number | null;
    behind: number | null;
}

export async function captureGitState(): Promise<GitStateSnapshot> {
    const status = await runGit(["status", "--porcelain=v1", "-b"]);
    if (status.code !== 0) {
        return {
            available: false,
            branch: null,
            entries: [],
            untrackedCount: 0,
            modifiedCount: 0,
            ahead: null,
            behind: null,
        };
    }
    const branchLine = status.stdout.split("\n")[0] ?? "";
    const branchMatch = branchLine.match(/^##\s+([^.\s[\]]+)/);
    const aheadMatch = branchLine.match(/ahead (\d+)/);
    const behindMatch = branchLine.match(/behind (\d+)/);

    const entries: GitStateSnapshot["entries"] = [];
    for (const line of status.stdout.split("\n").slice(1)) {
        if (line.trim() === "") continue;
        const st = line.slice(0, 2);
        const rest = line.slice(3);
        const [pathPart, origPath] = rest.split("\t");
        entries.push({ status: st, path: (pathPart ?? "").trim(), origPath: origPath?.trim() });
    }

    const modified = entries.filter((e) => e.status.trim() !== "??");
    const untracked = entries.filter((e) => e.status.trim() === "??");

    return {
        available: true,
        branch: branchMatch ? branchMatch[1] : null,
        entries,
        untrackedCount: untracked.length,
        modifiedCount: modified.length,
        ahead: aheadMatch ? Number(aheadMatch[1]) : null,
        behind: behindMatch ? Number(behindMatch[1]) : null,
    };
}

/** Unified diff of the working tree (optionally staged, optionally path-scoped). */
export async function captureGitDiff(staged: boolean, pathspec?: string): Promise<string | null> {
    const diffArgs = staged ? ["diff", "--cached"] : ["diff"];
    if (pathspec) diffArgs.push("--", pathspec);
    const res = await runGit(diffArgs);
    return res.code === 0 ? res.stdout : null;
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const gitStatusTool = defineTool(
    {
        id: "git.status",
        description: "Show working-tree status: branch, ahead/behind, modified and untracked files.",
        category: "git",
        argsHint: "{}",
    },
    async () => {
    const snap = await captureGitState();
    if (!snap.available) {
        return fail("Git is not available in this workspace.", "git_unavailable");
    }
    const lines = [
        `branch: ${snap.branch ?? "?"} (ahead ${snap.ahead ?? "?"}, behind ${snap.behind ?? "?"})`,
        `modified/staged: ${snap.modifiedCount}, untracked: ${snap.untrackedCount}`,
        "",
        ...snap.entries.slice(0, 100).map((e) => `${e.status}  ${e.path}${e.origPath ? ` ← ${e.origPath}` : ""}`),
    ].join("\n");
    return ok(
        {
            branch: snap.branch,
            ahead: snap.ahead,
            behind: snap.behind,
            modifiedCount: snap.modifiedCount,
            untrackedCount: snap.untrackedCount,
            entries: snap.entries.slice(0, 200),
        },
        lines,
    );
    },
);

export const gitDiffTool = defineTool(
    {
        id: "git.diff",
        description: "Unified diff of working tree or staged changes (redacted, capped).",
        category: "git",
        argsHint: "{ staged?: boolean, path?: string }",
    },
    async (args) => {
    const staged = args.staged === true;
    const pathspec = typeof args.path === "string" && args.path.trim() !== "" ? args.path.trim() : undefined;
    const text = await captureGitDiff(staged, pathspec);
    if (text === null) return fail("git diff failed.", "git_failed");
    return ok({ staged, empty: text.trim() === "" }, text.trim() === "" ? "No changes." : text);
    },
);

export const gitLogTool = defineTool(
    {
        id: "git.log",
        description: "Recent commit history (read-only).",
        category: "git",
        argsHint: "{ count?: number }",
    },
    async (args) => {
    const count = typeof args.count === "number" && Number.isFinite(args.count) ? Math.min(Math.floor(args.count), 40) : 10;
    const res = await runGit(["log", `--max-count=${count}`, "--pretty=format:%h %ad %s", "--date=short"]);
    if (res.code !== 0) return fail(capAndRedact(res.stderr) || "git log failed.", "git_failed");
    return ok(undefined, res.stdout);
    },
);

export const gitBranchTool = defineTool(
    {
        id: "git.branch",
        description: "Current branch name plus a change summary.",
        category: "git",
        argsHint: "{}",
    },
    async () => {
    const res = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (res.code !== 0) return fail(capAndRedact(res.stderr) || "git rev-parse failed.", "git_failed");
    const state = await captureGitState();
    return ok(
        { branch: res.stdout.trim() },
        `Current branch: ${res.stdout.trim()} — ${state.modifiedCount} modified, ${state.untrackedCount} untracked.`,
    );
    },
);

/**
 * Confirmation-gated commit. Only files the AGENT changed this run may be
 * staged (explicit paths or tracked modifications) — never `git add -A`, never
 * unrelated user work, never untracked files the agent did not create.
 */
export const gitCommitTool = defineTool(
    {
        id: "git.commit",
        description: "Confirmation-gated commit. Stages only agent-changed files (explicit paths or tracked modifications).",
        category: "git",
        argsHint: "{ message: string, paths?: string[], stageTracked?: boolean }",
    },
    async (args) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (message === "") return fail("A non-empty commit message is required.", "invalid_args");

    const explicitPaths = Array.isArray(args.paths)
        ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "")
        : [];
    const stageTracked = args.stageTracked === true;

    if (explicitPaths.length === 0 && !stageTracked) {
        return fail(
            "Commit requires explicit paths (agent-changed files only) or stageTracked: true. Bulk staging is refused.",
            "invalid_args",
        );
    }

    if (stageTracked) {
        const add = await runGit(["add", "-u"]);
        if (add.code !== 0) return fail(capAndRedact(add.stderr) || "git add failed.", "git_failed");
    }

    for (const p of explicitPaths) {
        const check = policyCheckPath(p);
        if (!check.ok) return fail(`Refusing to stage ${p}: ${check.reason}`, "policy_denied");
    }
    if (explicitPaths.length > 0) {
        const add = await runGit(["add", "--", ...explicitPaths]);
        if (add.code !== 0) return fail(capAndRedact(add.stderr) || "git add failed.", "git_failed");
    }

    const safeMessage = redactSecrets(message).slice(0, 500);
    const commit = await runGit(["commit", "-m", safeMessage]);
    if (commit.code !== 0) {
        return fail(capAndRedact(commit.stderr) || "git commit failed.", "git_failed");
    }
    const hash = await runGit(["rev-parse", "--short", "HEAD"]);
    return ok(
        { committed: true, hash: hash.code === 0 ? hash.stdout.trim() : null, message: safeMessage },
        `Committed ${hash.code === 0 ? hash.stdout.trim() : ""}: ${safeMessage.slice(0, 200)}`,
    );
    },
);
