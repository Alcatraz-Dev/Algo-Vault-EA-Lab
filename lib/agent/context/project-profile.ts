// AlgoVault Agent IDE — Project Profile
//
// The agent's specialization: the platform constraints it enforces for this
// repository. Kept as data (no DB import) so tests can assert on it and the
// runtime can include it in planner prompts. A copy can be published to
// `agentProjectProfile` in RTDB for cross-user consistency; the built-in data
// here is the source of truth when RTDB has none.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectProfile {
    platform: string;
    mission: string;
    stack: string[];
    constraints: string[];
    /** Evidence-driven rule for Market Intelligence work. */
    marketIntelligence: string[];
    tradingConstraints: string[];
    designSystem: string[];
    testingConventions: string[];
}

export const ALGOVAULT_PROFILE: ProjectProfile = {
    platform: "AlgoVault",
    mission:
        "Develop, debug, test, inspect, document and verify the AlgoVault trading platform. Nothing else.",
    stack: [
        "Next.js 16 App Router (app/)",
        "React 19",
        "TypeScript strict",
        "Tailwind CSS v4",
        "Firebase Auth + Firebase RTDB (realtime database) — NEVER Firestore",
    ],
    constraints: [
        "RTDB only. Never introduce Firestore in any form.",
        "AI requests go through lib/ai/router.ts (defaultRouter) with AIRequestContext; never call providers directly.",
        "AI budget guard is pre-flight and fail-closed; never bypass or weaken it.",
        "API routes authenticate server-side (requireAdmin / authenticate) before touching data.",
        "Respect Pro-gating (lib/workflows/limits.ts resolveEntitlement) for user-facing automation features.",
        "Do not fork or duplicate existing subsystems (lib/agents, lib/workflows, lib/ai): integrate with them.",
        "No new dependencies without explicit human approval; package installation is restricted.",
        "Never push to git remotes; commits require confirmation; deployments are out of agent reach.",
    ],
    marketIntelligence: [
        "Market Intelligence is evidence-driven: AI interpretations must remain grounded in deterministic evidence.",
        "Never invent trading facts, data, or signals.",
        "Integrate with the existing Market Intelligence modules; do not create a second engine.",
    ],
    tradingConstraints: [
        "Preserve anti-lookahead / next-bar execution protections in backtesting code.",
        "Never modify backtest logic to improve reported performance metrics.",
        "The agent is a software engineering assistant — not a financial advisor; never turn its output into trading advice.",
    ],
    designSystem: [
        "Follow ALGOVAULT_AGENT_CONSTITUTION.md §54 design tokens.",
        "Semantic colors (positive/negative/warning/info/primary); radius rules; min text size text-[11px].",
        "No gradients, no glass effects, no per-page headers — AppShell owns page headers.",
        "Keep UI native to AlgoVault's dark/light SaaS design language.",
    ],
    testingConventions: [
        "No vitest. Tests are custom jiti runners: node scripts/jiti-tsrun.mjs <runner.ts>.",
        "Runners self-execute at top level with a check(cond, label) pattern.",
        "Never add a new test framework; extend the jiti runner pattern.",
    ],
};

/** Compact text rendering for planner prompts. */
export function profileToPromptText(profile: ProjectProfile = ALGOVAULT_PROFILE): string {
    const lines: string[] = [];
    lines.push(`Platform: ${profile.platform}. Mission: ${profile.mission}`);
    lines.push(`Stack: ${profile.stack.join("; ")}`);
    lines.push("Constraints:");
    for (const c of profile.constraints) lines.push(`  - ${c}`);
    lines.push("Market Intelligence:");
    for (const c of profile.marketIntelligence) lines.push(`  - ${c}`);
    lines.push("Trading:");
    for (const c of profile.tradingConstraints) lines.push(`  - ${c}`);
    lines.push("Design:");
    for (const c of profile.designSystem) lines.push(`  - ${c}`);
    lines.push("Testing:");
    for (const c of profile.testingConventions) lines.push(`  - ${c}`);
    return lines.join("\n");
}
