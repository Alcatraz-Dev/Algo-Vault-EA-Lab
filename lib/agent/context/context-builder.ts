// AlgoVault Agent IDE — Context Builder
//
// Targeted retrieval: the agent does NOT ship the repository to the model. The
// builder composes a bounded context (repo map, task-relevant files, memory,
// docs, git state, project profile) with hard character budgets per section so
// prompts stay small and relevant.
// ─────────────────────────────────────────────────────────────────────────────

import { buildRepoMap, renderRepoMap } from "./repo-map";
import { ALGOVAULT_PROFILE, profileToPromptText } from "./project-profile";
import { evaluateProjectRules } from "./rule-engine";
import { listMemoryEntries } from "../core/rtdb-store";
import { checkPath, getProjectRoot } from "../policies/path-sandbox";
import { isSensitiveRelPath } from "../policies/path-sandbox";
import { captureGitState } from "../tools/git-tools";
import { redactSecrets } from "../policies/redaction";
import type { ToolExecutionContext } from "../core/types";

const BUDGET = {
    repoMap: 2_000,
    profile: 2_500,
    memory: 2_500,
    git: 1_000,
    file: 6_000,
    totalFiles: 18_000,
    total: 32_000,
};

export interface BuiltContext {
    text: string;
    relevantFiles: string[];
    memoryHits: number;
    builtAt: number;
}

/** Section-weighted keyword extraction from the request. */
function extractKeywords(request: string): string[] {
    const stop = new Set([
        "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with", "is", "are",
        "be", "should", "would", "could", "can", "you", "i", "we", "it", "this", "that",
        "add", "fix", "make", "please", "agent", "algovault", "project", "code", "use", "using",
    ]);
    return [...new Set(
        request.toLowerCase().replace(/[^a-z0-9\s./-]/g, " ").split(/\s+/)
            .filter((w) => w.length > 2 && !stop.has(w)),
    )].slice(0, 12);
}

/** Score files by path relevance to the request keywords. */
function scoreFile(pathRel: string, keywords: string[]): number {
    const lower = pathRel.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
        const token = kw.replace(/[^a-z0-9-]/g, "");
        if (token.length < 3) continue;
        if (lower.includes(token)) score += 3;
    }
    // Structure signals.
    if (/^(app|components|lib)\//.test(lower)) score += 1;
    if (lower.endsWith("route.ts") || lower.endsWith("route.tsx")) score += 1;
    if (lower.includes("test")) score += 1;
    if (lower.endsWith(".md")) score -= 1;
    return score;
}

/**
 * Build the model context for a request. Never throws — a failed section is
 * skipped, an empty context is still usable.
 */
export async function buildContext(request: string, ctx: ToolExecutionContext): Promise<BuiltContext> {
    const sections: string[] = [];
    const keywords = extractKeywords(request);

    // 1. Profile (static).
    sections.push(`## AlgoVault project profile\n${profileToPromptText()}`.slice(0, BUDGET.profile));

    // 2. Repo map.
    const repoEntries = await buildRepoMap(ctx.signal).catch(() => []);
    sections.push(`## Repository map\n${renderRepoMap(repoEntries)}`.slice(0, BUDGET.repoMap));

    // 3. Git state (pre-existing changes matter for regression protection).
    const git = await captureGitState().catch(() => null);
    if (git?.available) {
        const gitText = [
            `branch: ${git.branch ?? "?"} (ahead ${git.ahead ?? "?"}, behind ${git.behind ?? "?"})`,
            `modified/staged: ${git.modifiedCount}, untracked: ${git.untrackedCount}`,
            git.entries.slice(0, 12).map((e) => `  ${e.status} ${e.path}`).join("\n"),
        ].join("\n");
        sections.push(`## Git state (pre-existing changes are user work — preserve them)\n${gitText}`.slice(0, BUDGET.git));
    }

    // 4. Memory (top matches by keyword overlap).
    let memoryHits = 0;
    try {
        const entries = await listMemoryEntries(ctx.uid);
        if (entries.length > 0) {
            const scored = entries
                .map((e) => {
                    const hay = `${e.title} ${e.body} ${e.tags.join(" ")}`.toLowerCase();
                    return { e, score: keywords.reduce((acc, k) => acc + (hay.includes(k) ? 1 : 0), 0) };
                })
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);
            memoryHits = scored.length;
            if (scored.length > 0) {
                sections.push(
                    `## Relevant engineering memory\n${scored.map(({ e }) => `- [${e.kind}] ${e.title}: ${e.body.slice(0, 200)}`).join("\n")}`.slice(0, BUDGET.memory),
                );
            }
        }
    } catch {
        // memory unavailable — continue without it
    }

    // 5. Task-relevant files (top-N by score, sandbox-checked, redacted).
    const relevantFiles: string[] = [];
    try {
        const root = getProjectRoot();
        if (root) {
            const scored = repoEntries
                .filter((e) => e.kind === "file" && e.size <= 48_000 && e.size > 0)
                .map((e) => ({ ...e, score: scoreFile(e.path, keywords) }))
                .filter((e) => e.score >= 4)
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);
            const fileSections: string[] = [];
            let used = 0;
            for (const f of scored) {
                const check = checkPath(f.path);
                if (!check.allowed || isSensitiveRelPath(f.path)) continue;
                try {
                    const fsp = await import("node:fs/promises");
                    const content = await fsp.readFile(check.absPath, "utf8");
                    const capped = redactSecrets(content.slice(0, BUDGET.file));
                    fileSections.push(`### ${f.path}\n\`\`\`\n${capped}${content.length > BUDGET.file ? "\n… [truncated]" : ""}\n\`\`\``);
                    relevantFiles.push(f.path);
                    used += capped.length;
                    if (used >= BUDGET.totalFiles) break;
                } catch {
                    continue;
                }
            }
            if (fileSections.length > 0) {
                sections.push(`## Relevant files\n${fileSections.join("\n\n")}`);
            }
        }
    } catch {
        // file context is best-effort
    }

    const text = sections.join("\n\n").slice(0, BUDGET.total);

    // Rule check on the request itself (cheap, pre-plan signal).
    const earlyConflicts = evaluateProjectRules({ paths: relevantFiles, changeSummary: request });
    if (earlyConflicts.length > 0) {
        sections.push(`## Rule warnings (pre-plan)\n${earlyConflicts.map((c) => `- [${c.rule.severity}] ${c.conflict}`).join("\n")}`);
    }

    return {
        text: redactSecrets(text),
        relevantFiles,
        memoryHits,
        builtAt: Date.now(),
    };
}

export { ALGOVAULT_PROFILE };
