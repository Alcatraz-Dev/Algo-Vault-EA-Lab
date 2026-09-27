// AlgoVault Agent IDE — Project Rule Engine
//
// Codified architecture constraints with pure `detect` functions. The runtime
// runs a plan's affected paths + change summary against these rules BEFORE
// executing steps, so conflicts stop or warn before code is modified.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProjectRule, RuleDetectionInput } from "../core/types";

function pathHas(pathLower: string, needle: string): boolean {
    return pathLower.includes(needle);
}

/** The active rule set — extend by adding entries, not by editing the engine. */
export const PROJECT_RULES: ProjectRule[] = [
    {
        id: "rtdb-only",
        title: "RTDB only — never Firestore",
        rationale:
            "AlgoVault's database architecture is Firebase Realtime Database. Introducing Firestore would fork the data layer, security rules and billing.",
        severity: "block",
        detect: ({ paths, changeSummary, diffText }: RuleDetectionInput): string | null => {
            const hay = `${changeSummary} ${diffText ?? ""}`.toLowerCase();
            const firestoreUsage =
                /firebase\/firestore/.test(hay) ||
                /getFirestore|addDoc|setDoc|getDoc\(|getDocs|onSnapshot/.test(hay);
            const touchesDbLayer = paths.some((p) => {
                const l = p.toLowerCase();
                return pathHas(l, "lib/") && (pathHas(l, "store") || pathHas(l, "database") || pathHas(l, "rtdb"));
            });
            if (firestoreUsage && touchesDbLayer) {
                return "Change appears to use Firestore APIs in the data layer. AlgoVault is RTDB-only.";
            }
            return null;
        },
    },
    {
        id: "ai-router-only",
        title: "All AI calls through lib/ai/router.ts",
        rationale:
            "Provider calls outside the router would bypass token accounting, the free-only model layer, and the budget guard.",
        severity: "block",
        detect: ({ paths, changeSummary, diffText }: RuleDetectionInput): string | null => {
            const hay = `${changeSummary} ${diffText ?? ""}`.toLowerCase();
            const directProviderImport =
                /from\s+["'][^"']*(gemini|openai|anthropic|@google\/generativeai|openrouter)[^"']*["']/.test(hay);
            const touchesLib = paths.some((p) => pathHas(p.toLowerCase(), "lib/"));
            if (directProviderImport && touchesLib) {
                return "Change appears to import a provider SDK directly. All AI calls must go through lib/ai/router.ts (defaultRouter).";
            }
            return null;
        },
    },
    {
        id: "market-intel-evidence",
        title: "Market Intelligence stays evidence-driven",
        rationale:
            "AI interpretations in Market Intelligence must remain grounded in deterministic evidence; invented trading facts are a correctness and trust risk.",
        severity: "warn",
        detect: ({ paths, changeSummary }: RuleDetectionInput): string | null => {
            const touchesMI = paths.some((p) => p.toLowerCase().includes("market-intelligence"));
            if (!touchesMI) return null;
            const suspicious = /\b(fake|simulated|mock|random|synthetic|hardcoded)\b[^.]{0,40}\b(signal|data|price|candle|evidence)\b/i.test(changeSummary);
            if (suspicious) {
                return "Change describes fabricated signal/price/evidence data in Market Intelligence. MI must stay evidence-driven.";
            }
            return null;
        },
    },
    {
        id: "trading-constraint-guard",
        title: "Preserve anti-lookahead backtesting rules",
        rationale:
            "Backtest integrity depends on next-bar execution and future-leakage protections; relaxing them fabricates performance.",
        severity: "block",
        detect: ({ paths, changeSummary, diffText }: RuleDetectionInput): string | null => {
            const touchesBacktest = paths.some((p) => {
                const l = p.toLowerCase();
                return pathHas(l, "backtest") || pathHas(l, "replay") || pathHas(l, "strategy-lab");
            });
            if (!touchesBacktest) return null;
            const hay = `${changeSummary} ${diffText ?? ""}`.toLowerCase();
            const suspicious =
                /\b(lookahead|look-ahead|future\s?(leak|data)|next[-\s]?bar)\b/.test(hay) &&
                /\b(remove|disable|skip|relax|bypass|delete)\b/.test(hay);
            if (suspicious) {
                return "Change appears to remove or bypass anti-lookahead / next-bar protections in backtesting code.";
            }
            return null;
        },
    },
    {
        id: "no-pro-gating-removal",
        title: "Preserve Pro-gating",
        rationale: "Pro-gating protects revenue and authorization boundaries.",
        severity: "warn",
        detect: ({ paths, changeSummary }: RuleDetectionInput): string | null => {
            const touchesLimits = paths.some((p) => p.toLowerCase().includes("limits.ts") || p.toLowerCase().includes("entitlement"));
            if (!touchesLimits) return null;
            if (/\b(remove|bypass|skip|disable)\b[^.]{0,40}\b(gate|gating|entitlement|paywall|subscription)\b/i.test(changeSummary)) {
                return "Change appears to remove or bypass Pro-gating (resolveEntitlement).";
            }
            return null;
        },
    },
];

/**
 * Evaluate a plan against all rules. Returns conflicts (block or warn).
 */
export function evaluateProjectRules(input: RuleDetectionInput): Array<{ rule: ProjectRule; conflict: string }> {
    const conflicts: Array<{ rule: ProjectRule; conflict: string }> = [];
    for (const rule of PROJECT_RULES) {
        try {
            const conflict = rule.detect(input);
            if (conflict) conflicts.push({ rule, conflict });
        } catch {
            // A rule crashing must never block legitimate work; skip it.
        }
    }
    return conflicts;
}
