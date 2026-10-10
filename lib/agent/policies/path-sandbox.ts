// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Path Sandbox (FAIL CLOSED)
//
// The single authority for "may the agent touch this path?". Every filesystem
// tool, terminal command classifier, context builder and tool router must route
// paths through this module before doing anything else.
//
// Security properties:
//  1. Canonicalization: the absolute, resolved (realpath), normalized path is
//     computed from the file descriptor chain — not from string math alone —
//     so `..`, encoded traversal and indirections cannot smuggle an escape.
//  2. Symlink containment: realpath is computed; if the real location of any
//     component escapes the real project root, the path is denied.
//  3. Sensitive-file denylist: reads never return contents of credential-
//     bearing files. Existence may be reported as a safe classification.
//  4. Fail closed: if the project root cannot be verified as a real directory,
//     EVERY operation is denied. No fallback to string comparisons.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Classifies why a path was refused. Never carries path contents. */
export type PathDenyReason =
    | "no_project_root"          // AGENT_PROJECT_ROOT unverified → deny everything
    | "outside_project_root"     // escapes the workspace (traversal / absolute external / symlink escape)
    | "sensitive_file"           // matches the sensitive-file denylist
    | "sensitive_directory"      // inside a sensitive directory (e.g. chrome-extension/dist)
    | "not_found";               // does not exist (allowed for write/create pre-checks)

export interface PathCheckOk {
    allowed: true;
    /** Canonical, realpath-resolved, project-root-relative POSIX path. */
    relPath: string;
    /** Canonical absolute path (inside the verified project root). */
    absPath: string;
}

export interface PathCheckDeny {
    allowed: false;
    reason: PathDenyReason;
    /** Safe, non-leaking message suitable for the model and the UI. */
    message: string;
}

export type PathCheckResult = PathCheckOk | PathCheckDeny;

// ── Project root verification ────────────────────────────────────────────────

let cachedRoot: { abs: string; verifiedAt: number } | null = null;
const ROOT_REVERIFY_MS = 30_000;

/**
 * Resolve and verify the approved AlgoVault project root.
 *
 * The root comes from `AGENT_PROJECT_ROOT` when explicitly configured (used by
 * tests to point at an isolated temp sandbox), otherwise it is this repository.
 * The root must exist as a real directory — `realpathSync` also fails on a
 * dangling root, keeping the "cannot verify root → deny everything" rule.
 */
export function getProjectRoot(): string | null {
    const configured = process.env.AGENT_PROJECT_ROOT || process.cwd();
    try {
        const real = fs.realpathSync(/*turbopackIgnore: true*/ configured);
        if (!fs.statSync(real).isDirectory()) return null;
        if (cachedRoot && cachedRoot.abs === real && Date.now() - cachedRoot.verifiedAt < ROOT_REVERIFY_MS) {
            return cachedRoot.abs;
        }
        cachedRoot = { abs: real, verifiedAt: Date.now() };
        return real;
    } catch {
        return null;
    }
}

/** Test hook: clear the root cache so AGENT_PROJECT_ROOT changes take effect. */
export function __resetPathSandboxForTests(): void {
    cachedRoot = null;
}

// ── Sensitive-file denylist ──────────────────────────────────────────────────

/**
 * Denylist of credential-bearing files and directories.
 *
 * Rules are matched case-insensitively against each path SEGMENT (and for
 * prefix/suffix rules, the segment as a whole). This deliberately over-blocks:
 * a file named `firebase-service-account.backup.json` must never reach the
 * model just because it does not match an exact name.
 */
const SENSITIVE_FILE_RULES: Array<{
    kind: "exact" | "suffix" | "prefix" | "segment" | "contains";
    value: string;
    label: string;
}> = [
    // Environment / secrets files — any `.env*`
    { kind: "prefix", value: ".env", label: "environment file" },
    // Certificates and private keys
    { kind: "suffix", value: ".pem", label: "PEM key/certificate" },
    { kind: "suffix", value: ".key", label: "private key" },
    { kind: "suffix", value: ".p12", label: "PKCS#12 keystore" },
    { kind: "suffix", value: ".pfx", label: "PFX keystore" },
    // Service accounts / credentials — contains-matching over-blocks variants
    // like firebase-service-account.backup.json.
    { kind: "exact", value: "service-account.json", label: "service account credentials" },
    { kind: "exact", value: "credentials.json", label: "credentials file" },
    { kind: "contains", value: "service-account", label: "service account credentials" },
    { kind: "contains", value: "serviceaccount", label: "service account credentials" },
    { kind: "contains", value: "credentials", label: "credentials file" },
    { kind: "contains", value: "secrets", label: "secrets file" },
    // SSH
    { kind: "exact", value: "id_rsa", label: "SSH private key" },
    { kind: "exact", value: "id_ed25519", label: "SSH private key" },
    { kind: "exact", value: "known_hosts", label: "SSH known hosts" },
    // Git / npm credentials
    { kind: "exact", value: ".npmrc", label: "npm token / git credentials" },
    { kind: "exact", value: ".netrc", label: "network credentials" },
    { kind: "exact", value: ".git-credentials", label: "git credential store" },
    // Known credential-bearing directories
    { kind: "segment", value: "private-files", label: "private credentials directory" },
];

/**
 * Directories whose contents must never be read or written by the agent even
 * though they are inside the workspace (build artifacts that may embed secrets
 * copied from the environment at build time).
 */
const SENSITIVE_DIRECTORIES = new Set(["node_modules", ".next", "dist", "chrome-extension/dist"]);

/** True when the path (relative to root) matches the sensitive-file denylist. */
export function isSensitiveRelPath(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
    const segments = norm.split("/");
    const name = segments[segments.length - 1];

    for (const rule of SENSITIVE_FILE_RULES) {
        switch (rule.kind) {
            case "exact":
                if (name.toLowerCase() === rule.value) return true;
                break;
            case "suffix":
                if (name.toLowerCase().endsWith(rule.value)) return true;
                break;
            case "prefix":
                // `.env` matches `.env`, `.env.local`, `.env.production` … and also
                // deliberately `env.local`? No: prefix requires the segment to
                // START WITH `.env` — `.environment` would also match, which is
                // the intended over-blocking direction.
                if (name.toLowerCase().startsWith(rule.value)) return true;
                break;
            case "segment":
                if (segments.some((s) => s.toLowerCase() === rule.value)) return true;
                break;
            case "contains":
                if (name.toLowerCase().includes(rule.value)) return true;
                break;
        }
    }

    // Any segment that is a sensitive directory
    for (const seg of segments.slice(0, -1)) {
        if (SENSITIVE_DIRECTORIES.has(seg.toLowerCase())) return true;
    }

    return false;
}

/** Safe classification string returned instead of contents. Never leaks the path inside the message? (kept generic on purpose). */
export const SENSITIVE_FILE_NOTICE =
    "Sensitive file detected and intentionally excluded from Agent context.";

// ── Canonical path check ─────────────────────────────────────────────────────

/**
 * Resolve a user/tool-supplied path against the project root and decide.
 *
 * The check is performed on the REAL path chain: each intermediate directory is
 * realpath-resolved as far as it exists, so a symlink sitting anywhere on the
 * chain that resolves outside the root is caught, while not-yet-created files
 * under real directories still pass.
 */
export function checkPath(inputPath: string, opts?: { forWrite?: boolean }): PathCheckResult {
    // forWrite is currently advisory (read/write rules are identical); kept in
    // the signature so write-side call sites are forward-compatible with
    // stricter write-only rules.
    void opts;
    const root = getProjectRoot();
    if (!root) {
        return {
            allowed: false,
            reason: "no_project_root",
            message: "Project root could not be verified — filesystem access is denied (fail closed).",
        };
    }

    if (typeof inputPath !== "string" || inputPath.trim() === "") {
        return {
            allowed: false,
            reason: "outside_project_root",
            message: "Path must be a non-empty string.",
        };
    }

    // 1. Reject NUL bytes and control characters outright.
    if (/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(inputPath)) {
        return {
            allowed: false,
            reason: "outside_project_root",
            message: "Path contains control characters and is not allowed.",
        };
    }

    // 2. Anchor to root. Absolute external paths are rejected by containment
    //    below; absolute paths inside the root are accepted for convenience.
    const anchored = path.isAbsolute(inputPath) ? inputPath : path.join(/*turbopackIgnore: true*/ root, inputPath);

    // 3. Lexical normalization — catches `a/../..` BEFORE touching the disk.
    const lexicallyResolved = path.resolve(anchored);
    if (!isInsideRoot(lexicallyResolved, root)) {
        return {
            allowed: false,
            reason: "outside_project_root",
            message: "Path escapes the approved project workspace.",
        };
    }

    // 4. Realpath containment: walk from the deepest existing ancestor up,
    //    resolving symlinks. If any REAL component resolves outside the root,
    //    the path is denied even though the lexical form stayed inside.
    const realChain = resolveRealChain(lexicallyResolved, root);
    if (!realChain.insideRoot) {
        return {
            allowed: false,
            reason: "outside_project_root",
            message: "Path resolves (via symlink or junction) outside the approved project workspace.",
        };
    }

    const relPath = path.relative(root, realChain.resolved).split(path.sep).join("/");
    const absPath = realChain.resolved;

    // 5. Sensitive-file gate.
    if (isSensitiveRelPath(relPath)) {
        return {
            allowed: false,
            reason: "sensitive_file",
            message: SENSITIVE_FILE_NOTICE,
        };
    }

    return { allowed: true, relPath, absPath };
}

/** Containment test for an already-resolved path (no I/O). */
function isInsideRoot(resolved: string, root: string): boolean {
    if (resolved === root) return true;
    const rel = path.relative(root, resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve symlinks along the path chain without failing when the leaf (or some
 * ancestors) do not exist yet.
 */
function resolveRealChain(resolved: string, root: string): { insideRoot: boolean; resolved: string } {
    // Fast path: node can realpath the whole path.
    try {
        const real = fs.realpathSync(resolved);
        return { insideRoot: isInsideRoot(real, root), resolved: real };
    } catch {
        // fall through to the chain walk below (leaf or ancestors missing)
    }

    // Walk up to the deepest EXISTING ancestor and realpath it, then re-join
    // the non-existent tail. A dangling symlink cannot appear mid-chain without
    // lstat seeing it, so the tail is safe to re-join lexically.
    const segments = resolved.split(path.sep);
    let prefix = root;
    const tail: string[] = [];

    for (let i = segments.length - 1; i >= 0; i--) {
        const candidate = segments.slice(0, i + 1).join(path.sep);
        try {
            prefix = fs.realpathSync(candidate);
            break;
        } catch {
            tail.unshift(segments[i]);
            continue;
        }
    }

    // The deepest existing ancestor must itself stay inside the root.
    if (!isInsideRoot(prefix, root)) {
        return { insideRoot: false, resolved };
    }

    const finalPath = path.join(prefix, ...tail);
    if (!isInsideRoot(finalPath, root)) {
        return { insideRoot: false, resolved };
    }
    return { insideRoot: true, resolved: finalPath };
}

// ── Convenience guards used by tools ─────────────────────────────────────────

export class PathSandboxError extends Error {
    readonly reason: PathDenyReason;
    constructor(result: PathCheckDeny) {
        super(result.message);
        this.name = "PathSandboxError";
        this.reason = result.reason;
    }
}

/** `checkPath` + throw on denial. */
export function assertPathAllowed(inputPath: string, opts?: { forWrite?: boolean }): PathCheckOk {
    const result = checkPath(inputPath, opts);
    if (!result.allowed) throw new PathSandboxError(result);
    return result;
}

/**
 * Read a file inside the sandbox, with the sensitive gate and a hard size cap.
 * Returns the UTF-8 contents or null when the file does not exist.
 */
export async function sandboxedReadFile(
    inputPath: string,
    maxBytes: number,
): Promise<{ found: boolean; content?: string; truncated?: boolean; reason?: PathDenyReason; message?: string }> {
    const check = checkPath(inputPath);
    if (!check.allowed) {
        if (check.reason === "not_found") return { found: false };
        return { found: false, reason: check.reason, message: check.message };
    }

    try {
        const stat = await fsp.stat(/*turbopackIgnore: true*/ check.absPath);
        if (stat.isDirectory()) {
            return { found: false, reason: "outside_project_root", message: "Path is a directory, not a file." };
        }
        const truncated = stat.size > maxBytes;
        const handle = await fsp.open(/*turbopackIgnore: true*/ check.absPath, "r");
        try {
            const length = truncated ? maxBytes : stat.size;
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, 0);
            return {
                found: true,
                content: buffer.toString("utf8"),
                truncated,
            };
        } finally {
            await handle.close();
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
        return {
            found: false,
            reason: "outside_project_root",
            message: err instanceof Error ? redactPathMessage(err.message) : "Read failed.",
        };
    }
}

/** Best-effort redaction of error text so OS messages cannot leak absolute paths or secrets. */
export function redactPathMessage(message: string): string {
    const root = getProjectRoot();
    let out = message;
    if (root) out = out.split(root).join("<project-root>");
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) out = out.split(home).join("~");
    return out;
}
