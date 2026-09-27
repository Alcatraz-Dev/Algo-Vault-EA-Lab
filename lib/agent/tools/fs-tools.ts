// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Filesystem Tools
//
// Every operation goes through the path sandbox (canonical resolution,
// traversal + symlink containment, sensitive denylist) AND the policy engine
// pre-checks before touching the disk. Writes are atomic (tmp + rename) so a
// crash cannot leave half-written sources behind.
// ─────────────────────────────────────────────────────────────────────────────

import fsp from "node:fs/promises";
import path from "node:path";
import { getProjectRoot, SENSITIVE_FILE_NOTICE, isSensitiveRelPath } from "../policies/path-sandbox";
import { policyCheckPath } from "../policies/permission-engine";
import { redactSecrets, redactErrorForLog } from "../policies/redaction";
import type { ToolResult } from "../core/types";
import { defineTool } from "../core/types";

const MAX_READ_BYTES = 96 * 1024;      // per-file read cap
const MAX_SEARCH_RESULTS = 120;
const MAX_OUTPUT_CHARS = 24_000;

function ok(data?: unknown, output?: string): ToolResult {
    return { ok: true, data, output };
}

function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}

function capOutput(text: string): string {
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [output truncated]` : text;
}
void capOutput;

/** Direct read of an already-validated absolute path. */
async function readValidatedFile(absPath: string, maxBytes: number): Promise<{ found: boolean; content?: string; truncated?: boolean; reason?: string; message?: string }> {
    try {
        const stat = await fsp.stat(absPath);
        if (stat.isDirectory()) return { found: false, reason: "policy_denied", message: "Path is a directory, not a file." };
        const truncated = stat.size > maxBytes;
        const handle = await fsp.open(absPath, "r");
        try {
            const length = truncated ? maxBytes : stat.size;
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, 0);
            return { found: true, content: buffer.toString("utf8"), truncated };
        } finally {
            await handle.close();
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
        return { found: false, reason: "policy_denied", message: redactErrorForLog(err) };
    }
}

function toRel(abs: string): string {
    const root = getProjectRoot();
    if (!root) return abs;
    return path.relative(root, abs).split(path.sep).join("/");
}

// ── fs.search — content search with denylist-aware node scan ────────────────

const SEARCH_SKIP = new Set([
    "node_modules", ".next", "dist", ".git", "private-files",
    ".kilo", "graphify-out", "marketing-video", ".impeccable",
]);

export const fsSearchTool = defineTool(
    {
        id: "fs.search",
        description: "Content search across the project workspace (denylist-aware, redacted).",
        category: "filesystem",
        argsHint: "{ pattern: string, subdir?: string, maxResults?: number }",
    },
    async (args, ctx) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return fail("pattern is required", "invalid_args");
    if (pattern.length > 200) return fail("pattern too long (max 200 chars)", "invalid_args");

    const subdir = typeof args.subdir === "string" && args.subdir.trim() !== "" ? args.subdir : ".";
    const pathCheck = policyCheckPath(subdir);
    if (!pathCheck.ok) return fail(pathCheck.reason, "policy_denied");
    const cwd = pathCheck.absPath;

    const maxResults = typeof args.maxResults === "number" && args.maxResults > 0
        ? Math.min(Math.floor(args.maxResults), MAX_SEARCH_RESULTS)
        : 30;

    let regex: RegExp;
    try {
        regex = new RegExp(pattern, "gi");
    } catch {
        return fail("invalid regular expression", "invalid_args");
    }

    const results: Array<{ path: string; line: number; text: string }> = [];
    const sensitiveHits: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (ctx.signal.aborted || results.length >= maxResults || depth > 9) return;
        const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
        if (!entries) return;
        for (const entry of entries) {
            if (ctx.signal.aborted || results.length >= maxResults) return;
            if (SEARCH_SKIP.has(entry.name)) continue;
            // Skip hidden dirs/files except a small allowlist.
            if (entry.name.startsWith(".") && ![".github", ".gitignore", ".eslintrc.json", ".prettierrc"].includes(entry.name)) continue;

            const full = `${dir}${path.sep}${entry.name}`;

            if (entry.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;

            const rel = toRel(full);
            if (isSensitiveRelPath(rel)) {
                // Existence is reportable; contents never are.
                sensitiveHits.push(rel);
                continue;
            }
            try {
                const stat = await fsp.stat(full);
                if (stat.size > 400_000) continue;
            } catch {
                continue;
            }
            let content: string;
            try {
                content = await fsp.readFile(full, "utf8");
            } catch {
                continue;
            }
            const lines = content.split(/\r?\n/);
            regex.lastIndex = 0;
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                regex.lastIndex = 0;
                if (regex.test(lines[i])) {
                    results.push({ path: rel, line: i + 1, text: redactSecrets(lines[i].slice(0, 240)) });
                }
            }
        }
    }

    await walk(cwd, 0);

    const outputParts: string[] = [];
    if (results.length > 0) {
        outputParts.push(results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n"));
    } else {
        outputParts.push("No matches.");
    }
    if (sensitiveHits.length > 0) {
        outputParts.push(`\n${sensitiveHits.length} sensitive file(s) detected and excluded: ${sensitiveHits.slice(0, 10).join(", ")}${sensitiveHits.length > 10 ? "…" : ""}`);
    }

    return ok({ matches: results.length, sensitiveExcluded: sensitiveHits.length }, outputParts.join(""));
    },
);

// ── fs.read ──────────────────────────────────────────────────────────────────

export const fsReadTool = defineTool(
    {
        id: "fs.read",
        description: "Read a project file (sandboxed, denylist-enforced, redacted, size-capped).",
        category: "filesystem",
        argsHint: "{ path: string }",
    },
    async (args) => {
    const pathArg = typeof args.path === "string" ? args.path : "";
    const check = policyCheckPath(pathArg);
    if (!check.ok) return fail(check.reason, "policy_denied");

    const result = await readValidatedFile(check.absPath, MAX_READ_BYTES);
    if (!result.found) {
        if (result.reason === "sensitive_file") return fail(SENSITIVE_FILE_NOTICE, "sensitive_file");
        if (result.reason) return fail(result.message ?? "Read denied.", "policy_denied");
        return fail("File not found.", "not_found");
    }
    return ok({ truncated: result.truncated === true, path: check.relPath }, result.content ?? "");
    },
);

// ── fs.write (create or overwrite) ───────────────────────────────────────────

export const fsWriteTool = defineTool(
    {
        id: "fs.write",
        description: "Create or overwrite a project file inside the workspace (atomic write).",
        category: "filesystem",
        argsHint: "{ path: string, content: string }",
    },
    async (args) => {
    const pathArg = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const check = policyCheckPath(pathArg, { forWrite: true });
    if (!check.ok) return fail(check.reason, "policy_denied");

    if (content.length > 400_000) {
        return fail("Content exceeds the 400KB single-write cap.", "too_large");
    }

    try {
        await fsp.mkdir(path.dirname(check.absPath), { recursive: true });
        const tmp = `${check.absPath}.agent-tmp-${process.pid}-${Date.now()}`;
        await fsp.writeFile(tmp, content, "utf8");
        await fsp.rename(tmp, check.absPath);
        return ok({ path: check.relPath, bytes: content.length }, `Wrote ${check.relPath} (${content.length} bytes).`);
    } catch (err) {
        return fail(err instanceof Error ? err.message : "Write failed.", "write_failed");
    }
    },
);

// ── fs.edit — exact-match replacements with ambiguity protection ─────────────

export const fsEditTool = defineTool(
    {
        id: "fs.edit",
        description: "Edit a project file with exact-match replacements (ambiguity-protected, atomic).",
        category: "filesystem",
        argsHint: "{ path: string, replacements: [{ oldString, newString, allowMultiple? }] }",
    },
    async (args) => {
    const pathArg = typeof args.path === "string" ? args.path : "";
    const check = policyCheckPath(pathArg, { forWrite: true });
    if (!check.ok) return fail(check.reason, "policy_denied");

    if (!Array.isArray(args.replacements) || args.replacements.length === 0) {
        return fail("replacements array is required", "invalid_args");
    }

    const read = await readValidatedFile(check.absPath, MAX_READ_BYTES);
    if (!read.found) {
        if (read.reason === "sensitive_file") return fail(SENSITIVE_FILE_NOTICE, "sensitive_file");
        return fail(read.message ?? "File not found.", read.reason === "policy_denied" ? "policy_denied" : "not_found");
    }
    if (read.truncated) {
        return fail("File exceeds the edit size cap; refusing partial edit (fail closed).", "too_large");
    }

    let content = read.content ?? "";
    let applied = 0;

    for (const repl of args.replacements as Array<Record<string, unknown>>) {
        const oldString = typeof repl?.oldString === "string" ? repl.oldString : null;
        const newString = typeof repl?.newString === "string" ? repl.newString : "";
        if (!oldString) return fail("Each replacement needs a non-empty oldString.", "invalid_args");

        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) {
            return fail(`oldString not found in ${check.relPath}.`, "edit_target_missing");
        }
        if (occurrences > 1 && repl?.allowMultiple !== true) {
            return fail(
                `oldString matches ${occurrences} times in ${check.relPath}. Include more surrounding context or pass allowMultiple: true.`,
                "edit_ambiguous",
            );
        }
        content = repl?.allowMultiple === true
            ? content.split(oldString).join(newString)
            : content.replace(oldString, newString);
        applied++;
    }

    try {
        const tmp = `${check.absPath}.agent-tmp-${process.pid}-${Date.now()}`;
        await fsp.writeFile(tmp, content, "utf8");
        await fsp.rename(tmp, check.absPath);
    } catch (err) {
        return fail(err instanceof Error ? err.message : "Edit failed.", "write_failed");
    }
    return ok({ path: check.relPath, replacements: applied }, `Edited ${check.relPath}: ${applied} replacement(s) applied.`);
    },
);

// ── fs.rename ────────────────────────────────────────────────────────────────

export const fsRenameTool = defineTool(
    {
        id: "fs.rename",
        description: "Rename/move a file or empty directory inside the workspace.",
        category: "filesystem",
        argsHint: "{ from: string, to: string }",
    },
    async (args) => {
    const from = typeof args.from === "string" ? args.from : "";
    const to = typeof args.to === "string" ? args.to : "";
    const fromCheck = policyCheckPath(from, { forWrite: true });
    if (!fromCheck.ok) return fail(fromCheck.reason, "policy_denied");
    const toCheck = policyCheckPath(to, { forWrite: true });
    if (!toCheck.ok) return fail(toCheck.reason, "policy_denied");

    try {
        const st = await fsp.lstat(fromCheck.absPath);
        if (st.isSymbolicLink()) {
            return fail("Renaming symlinks is not allowed.", "policy_denied");
        }
        await fsp.rename(fromCheck.absPath, toCheck.absPath);
        return ok({ from: fromCheck.relPath, to: toCheck.relPath }, `Renamed ${fromCheck.relPath} → ${toCheck.relPath}.`);
    } catch (err) {
        return fail(err instanceof Error ? err.message : "Rename failed.", "rename_failed");
    }
    },
);

// ── fs.delete — single file or empty directory ONLY, confirmation-gated ──────

export const fsDeleteTool = defineTool(
    {
        id: "fs.delete",
        description: "Delete a single file or empty directory (confirmation-gated; recursive delete structurally blocked).",
        category: "filesystem",
        argsHint: "{ path: string }",
    },
    async (args) => {
    const pathArg = typeof args.path === "string" ? args.path : "";
    const check = policyCheckPath(pathArg, { forWrite: true });
    if (!check.ok) return fail(check.reason, "policy_denied");

    let st;
    try {
        st = await fsp.lstat(check.absPath);
    } catch {
        return fail("Path not found.", "not_found");
    }
    if (st.isSymbolicLink()) {
        return fail("Deleting symlinks is not allowed.", "policy_denied");
    }
    if (st.isDirectory()) {
        const children = await fsp.readdir(check.absPath);
        if (children.length > 0) {
            return fail(
                "Directory is not empty — recursive deletion is structurally blocked. Delete files individually, each with confirmation.",
                "policy_denied",
            );
        }
    }
    try {
        await fsp.rm(check.absPath, { recursive: false, force: false });
        return ok({ path: check.relPath }, `Deleted ${check.relPath}.`);
    } catch (err) {
        return fail(err instanceof Error ? err.message : "Delete failed.", "delete_failed");
    }
    },
);
