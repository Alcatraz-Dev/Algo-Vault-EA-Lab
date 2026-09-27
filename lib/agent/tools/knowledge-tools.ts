// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Knowledge Tools
//
// Durable engineering memory (RTDB-backed, sanitized) plus documentation and
// architecture lookups over the repository's canon docs. Memory writes are
// scrubbed by the same persistence sanitizer used for run records, so secrets
// cannot be stored as "memory".
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import {
    listMemoryEntries,
    saveMemoryEntry,
    deleteMemoryEntry,
    getProjectProfile,
    bumpMemoryHits,
} from "../core/rtdb-store";
import { redactSecrets, redactErrorForLog } from "../policies/redaction";
import { checkPath } from "../policies/path-sandbox";
import type { AgentMemoryEntry, MemoryKind, ToolResult } from "../core/types";
import { defineTool } from "../core/types";

const MAX_MEMORY_BODY_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 16_000;

function ok(data?: unknown, output?: string): ToolResult {
    return { ok: true, data, output };
}
function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}

const VALID_KINDS = new Set<string>(["project_decision", "architecture_constraint", "completed_task", "known_regression", "resolved_error", "implementation_pattern"]);

// ── memory.write ─────────────────────────────────────────────────────────────

export const memoryWriteTool = defineTool(
    {
        id: "memory.write",
        description: "Store a durable engineering memory entry (decisions, constraints, patterns; secrets scrubbed).",
        category: "memory",
        argsHint: "{ kind: string, title: string, body: string, tags?: string[] }",
    },
    async (args, ctx) => {
    const kind = typeof args.kind === "string" && VALID_KINDS.has(args.kind) ? args.kind as MemoryKind : null;
    const title = typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
    const body = typeof args.body === "string" ? args.body.trim().slice(0, MAX_MEMORY_BODY_CHARS) : "";
    const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40))
        : [];

    if (!kind) return fail(`kind must be one of: ${[...VALID_KINDS].join(", ")}`, "invalid_args");
    if (title === "" || body === "") return fail("title and body are required", "invalid_args");

    const entry: AgentMemoryEntry = {
        id: `mem_${randomUUID().slice(0, 8)}`,
        kind,
        title,
        body: redactSecrets(body),
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: ctx.runId,
        hits: 0,
    };

    try {
        await saveMemoryEntry(ctx.uid, entry);
        return ok({ id: entry.id }, `Remembered (${kind}): ${title}`);
    } catch (err) {
        return fail(redactErrorForLog(err), "memory_write_failed");
    }
    },
);

// ── memory.list / memory.search / memory.delete ──────────────────────────────

export const memoryListTool = defineTool(
    {
        id: "memory.list",
        description: "List stored engineering memory entries.",
        category: "memory",
        argsHint: "{}",
    },
    async (_args, ctx) => {
    try {
        const entries = await listMemoryEntries(ctx.uid);
        if (entries.length === 0) return ok({ count: 0 }, "Memory is empty.");
        const lines = entries.slice(0, 50).map((e) => `[${e.kind}] ${e.title} — ${e.body.slice(0, 120)}`);
        return ok({ count: entries.length }, lines.join("\n"));
    } catch (err) {
        return fail(redactErrorForLog(err), "memory_read_failed");
    }
    },
);

export const memorySearchTool = defineTool(
    {
        id: "memory.search",
        description: "Search engineering memory by keywords.",
        category: "memory",
        argsHint: "{ query: string }",
    },
    async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    if (query === "") return fail("query is required", "invalid_args");
    try {
        const entries = await listMemoryEntries(ctx.uid);
        const terms = query.split(/\s+/).filter(Boolean);
        const scored = entries
            .map((e) => {
                const haystack = `${e.title} ${e.body} ${e.tags.join(" ")}`.toLowerCase();
                const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
                return { e, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
        if (scored.length === 0) return ok({ matches: 0 }, "No relevant memory.");
        for (const { e } of scored) {
            void bumpMemoryHits(ctx.uid, e.id);
        }
        return ok(
            { matches: scored.length },
            scored.map(({ e }) => `[${e.kind}] ${e.title} — ${e.body.slice(0, 300)}`).join("\n---\n"),
        );
    } catch (err) {
        return fail(redactErrorForLog(err), "memory_read_failed");
    }
    },
);

export const memoryDeleteTool = defineTool(
    {
        id: "memory.delete",
        description: "Delete one memory entry by id (confirmation-gated).",
        category: "memory",
        argsHint: "{ id: string }",
    },
    async (args, ctx) => {
    const id = typeof args.id === "string" ? args.id : "";
    if (id === "") return fail("id is required", "invalid_args");
    try {
        await deleteMemoryEntry(ctx.uid, id);
        return ok(undefined, `Memory ${id} deleted.`);
    } catch (err) {
        return fail(redactErrorForLog(err), "memory_delete_failed");
    }
    },
);

// ── docs.search — canon documentation lookup ────────────────────────────────

const CANON_DOCS = [
    "ALGOVAULT_AGENT_CONSTITUTION.md",
    "ALGOVAULT_PROJECT_MEMORY.md",
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
];

export const docsSearchTool = defineTool(
    {
        id: "docs.search",
        description: "Search the canon documentation (constitution, project memory, README) by keywords.",
        category: "knowledge",
        argsHint: "{ query: string }",
    },
    async (args) => {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    if (query === "") return fail("query is required", "invalid_args");
    const terms = query.split(/\s+/).filter(Boolean);
    const results: Array<{ doc: string; section: string; excerpt: string }> = [];

    for (const doc of CANON_DOCS) {
        const check = checkPath(doc);
        if (!check.allowed) continue;
        try {
            const fsp = await import("node:fs/promises");
            const content = await fsp.readFile(check.absPath, "utf8");
            const sections = content.split(/\n(?=#{1,3} )/);
            for (const section of sections) {
                const lower = section.toLowerCase();
                const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
                if (score > 0) {
                    const firstLine = section.split("\n")[0]?.replace(/^#+\s*/, "") || doc;
                    results.push({
                        doc,
                        section: firstLine.slice(0, 120),
                        excerpt: redactSecrets(section.slice(0, 700)),
                    });
                }
                if (results.length >= 12) break;
            }
        } catch {
            continue; // missing doc is fine
        }
        if (results.length >= 12) break;
    }

    if (results.length === 0) return ok({ matches: 0 }, "No documentation matches.");
    return ok(
        { matches: results.length },
        results.map((r) => `### ${r.doc} › ${r.section}\n${r.excerpt}`).join("\n\n"),
    );
    },
);

// ── profile.get — the AlgoVault specialization profile ──────────────────────

export const profileGetTool = defineTool(
    {
        id: "profile.get",
        description: "Show the AlgoVault specialization profile: constraints the agent enforces for this platform.",
        category: "knowledge",
        argsHint: "{}",
    },
    async () => {
    try {
        const profile = await getProjectProfile();
        if (!profile) {
            return ok({ source: "builtin" }, PROFILE_FALLBACK_TEXT);
        }
        return ok({ source: "rtdb" }, JSON.stringify(profile, null, 2).slice(0, MAX_OUTPUT_CHARS));
    } catch (err) {
        return fail(redactErrorForLog(err), "profile_read_failed");
    }
    },
);

const PROFILE_FALLBACK_TEXT = "Built-in AlgoVault project profile (see lib/agent/context/project-profile.ts).";
