// AlgoVault Agent IDE — Repo Map
//
// Compact, denylist-aware structural summary of the workspace. Cached per
// process with a TTL; invalidate via __resetRepoMapForTests(). Used by the
// context builder to select relevant files without sending the repo tree to
// the model on every request.
// ─────────────────────────────────────────────────────────────────────────────

import fsp from "node:fs/promises";
import path from "node:path";
import { getProjectRoot } from "../policies/path-sandbox";
import { isSensitiveRelPath } from "../policies/path-sandbox";
import type { ToolExecutionContext } from "../core/types";

const CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 2_500;

interface RepoMapEntry {
    path: string;
    kind: "file" | "dir";
    size: number;
}

interface CachedMap {
    builtAt: number;
    entries: RepoMapEntry[];
}

let cache: CachedMap | null = null;

/** Directories excluded from the map (junk + build output). */
const SKIP_DIRS = new Set([
    "node_modules", ".next", "dist", ".git", "private-files",
    ".kilo", "graphify-out", "marketing-video", ".impeccable",
    "chrome-extension/dist", "coverage", ".turbo", ".vercel",
]);

export async function buildRepoMap(signal?: AbortSignal): Promise<RepoMapEntry[]> {
    const root = getProjectRoot();
    if (!root) return [];

    if (cache && Date.now() - cache.builtAt < CACHE_TTL_MS) {
        return cache.entries;
    }

    const entries: RepoMapEntry[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (signal?.aborted || entries.length >= MAX_ENTRIES || depth > 7) return;
        const children = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
        if (!children) return;
        for (const child of children) {
            if (signal?.aborted || entries.length >= MAX_ENTRIES) return;
            if (SKIP_DIRS.has(child.name)) continue;
            if (child.name.startsWith(".") && ![".github", ".gitignore", ".eslintrc.json"].includes(child.name)) continue;

            const full = `${dir}${path.sep}${child.name}`;
            if (child.isDirectory()) {
                entries.push({ path: toRel(full), kind: "dir", size: 0 });
                await walk(full, depth + 1);
            } else if (child.isFile()) {
                const rel = toRel(full);
                if (isSensitiveRelPath(rel)) continue;
                let size = 0;
                try {
                    size = (await fsp.stat(full)).size;
                } catch {
                    continue;
                }
                entries.push({ path: rel, kind: "file", size });
            }
        }
    }

    await walk(root, 0);
    cache = { builtAt: Date.now(), entries };
    return entries;
}

function toRel(abs: string): string {
    const root = getProjectRoot();
    if (!root) return abs;
    return path.relative(root, abs).split(path.sep).join("/");
}

/** Render a compact tree string with optional per-area file counts. */
export function renderRepoMap(entries: RepoMapEntry[], maxLines = 220): string {
    const dirs = new Map<string, number>();
    const rootFiles: string[] = [];
    for (const e of entries) {
        if (e.kind === "dir") continue;
        const top = e.path.includes("/") ? e.path.split("/").slice(0, 2).join("/") : "(root)";
        dirs.set(top, (dirs.get(top) ?? 0) + 1);
        if (!e.path.includes("/")) rootFiles.push(e.path);
    }
    const lines: string[] = [];
    lines.push(`(repo map: ${entries.filter((e) => e.kind === "file").length} files, cache TTL 60s)`);
    lines.push("Top-level areas (file counts):");
    for (const [area, count] of [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
        lines.push(`  ${area}: ${count}`);
    }
    if (rootFiles.length > 0) {
        lines.push(`Root files: ${rootFiles.slice(0, 30).join(", ")}${rootFiles.length > 30 ? "…" : ""}`);
    }
    void maxLines;
    return lines.join("\n");
}

/** Reset the cache (tests). */
export function __resetRepoMapForTests(): void {
    cache = null;
}

// Keep the ToolExecutionContext import referenced for future scope filtering.
export type { ToolExecutionContext };
