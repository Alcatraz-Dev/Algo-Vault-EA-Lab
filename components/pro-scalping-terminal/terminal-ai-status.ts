/**
 * Terminal AI status — the truth behind the header chip.
 *
 * The old chip hard-coded "Deterministic · 0 AI spend" forever, which is a
 * lie the moment the Intelligence decision panel serves an LLM-backed
 * decision, the user arms AI Draw, or Candel runs an analysis. This module
 * derives the chip's state from what actually happened, and names both sides
 * in the tooltip:
 *
 *   • Deterministic core — chart, radar, risk, journal: pure measurement
 *     pipeline, never an LLM call.
 *   • AI-backed surfaces — Intelligence decision panel (LLM), AI Draw, Candel
 *     (/api/ai/analyze). Each completed call is counted.
 *
 * Leaf module on purpose (no React, no fetch, no chart): the terminal tests
 * exercise it directly, and the component only renders what it returns.
 */

import type { AITask } from "@/lib/intelligence/versions";
import type { TerminalIntelligencePayload } from "./IntelligencePanel";

/**
 * A decision counts as "fresh AI spend" only when the server produced it
 * moments ago (`cachedAt` close to arrival). An older `cachedAt` is a cache
 * hit: real AI spend, but not this session's — the chip stays truthful
 * either way by reporting what *this session* observed.
 * (Agreed window: ~15–20s; 18s absorbs a slow poll round-trip.)
 */
export const AI_DECISION_FRESH_MS = 18_000;

/** True when the payload carries an LLM decision the server just computed. */
export function isFreshLlmDecision(
    cachedAt: number | null | undefined,
    receivedAt: number | null | undefined,
): boolean {
    if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt) || cachedAt <= 0) return false;
    if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) return false;
    // A negative delta is clock skew (client behind server) — still fresh.
    return receivedAt - cachedAt <= AI_DECISION_FRESH_MS;
}

export interface TerminalAiStatusInput {
    /** Fresh LLM-backed Intelligence decisions observed this session. */
    llmDecisions: number;
    /** Candel analyses completed through /api/ai/analyze this session. */
    candelCalls: number;
    /** AI Draw armed (the gate is on). */
    aiDrawEnabled: boolean;
    /** Intelligence decision layer: reachable, still loading, or erroring. */
    decisionLayer: "ok" | "loading" | "unavailable";
}

export interface TerminalAiStatus {
    /** Chip tone: neutral = nothing AI-backed, info = AI activity, warning = activity that cannot be verified. */
    tone: "neutral" | "info" | "warning";
    label: string;
    tooltip: string;
    /** AI calls attributed to this session (fresh LLM decisions + Candel). */
    totalCalls: number;
    /** Any AI-backed surface active — swaps the chip icon. */
    aiActive: boolean;
}

const DETERMINISTIC_LINE =
    "Deterministic core (chart, radar, risk, journal): pure measurement — no LLM calls, no AI spend.";

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The chip's live status. Counts are session-observed, the split between
 * deterministic and AI-backed surfaces is always spelled out in the tooltip,
 * and an unreachable decision layer is surfaced instead of papered over.
 */
export function terminalAiStatus(input: TerminalAiStatusInput): TerminalAiStatus {
    const llmDecisions = Math.max(0, Math.trunc(input.llmDecisions || 0));
    const candelCalls = Math.max(0, Math.trunc(input.candelCalls || 0));
    const totalCalls = llmDecisions + candelCalls;
    const aiActive = totalCalls > 0 || input.aiDrawEnabled;

    if (!aiActive) {
        return {
            tone: "neutral",
            label: "Deterministic · 0 AI calls",
            tooltip: [
                DETERMINISTIC_LINE,
                "AI-backed surfaces — Intelligence decision panel, AI Draw, Candel: idle.",
                "0 AI calls this session.",
            ].join("\n"),
            totalCalls,
            aiActive,
        };
    }

    if (input.decisionLayer === "unavailable") {
        return {
            tone: "warning",
            label: "AI · status unknown",
            tooltip: [
                `AI calls this session: ${plural(totalCalls, "call")} — but the Intelligence decision layer is unreachable, so the AI-backed state cannot be verified.`,
                DETERMINISTIC_LINE,
            ].join("\n"),
            totalCalls,
            aiActive,
        };
    }

    const label =
        totalCalls > 0
            ? `AI assist · ${plural(totalCalls, "call")}`
            : "AI Draw on · 0 calls";
    return {
        tone: "info",
        label,
        tooltip: [
            DETERMINISTIC_LINE,
            `AI-backed — Intelligence decision panel: ${plural(llmDecisions, "fresh LLM decision")}; Candel: ${plural(candelCalls, "analysis")} this session; AI Draw ${input.aiDrawEnabled ? "armed" : "off"}.`,
            `Total AI calls this session: ${totalCalls}.`,
        ].join("\n"),
        totalCalls,
        aiActive,
    };
}

// ── Candel observation mapping ──────────────────────────────────────────────

export type CandelObservationType = "fact" | "interpretation" | "limitation";

/**
 * Classify a decision factor for the Candel panel: deterministic / market
 * facts read as facts, policy reads as a limitation, everything else
 * (including AI reasoning) is labelled an interpretation — never a fact.
 */
export function candelObservationType(source: string): CandelObservationType {
    if (source === "market_facts" || source === "deterministic") return "fact";
    if (source === "policy") return "limitation";
    return "interpretation";
}

/** The Intelligence payload's factors as Candel observations (pure mapping). */
export function candelObservations(
    payload: TerminalIntelligencePayload | null | undefined,
): Array<{ type: CandelObservationType; text: string }> {
    const factors = payload?.decision?.factors ?? [];
    return factors.map((f) => ({
        type: candelObservationType(f.source),
        text: `${f.label} — ${f.value}`,
    }));
}

// ── Candel quick-action routing ─────────────────────────────────────────────

export interface CandelActionRequest {
    task: AITask;
    question: string;
}

/**
 * Quick-action key → fabric task + question. Every task here is free-tier
 * eligible (none of the PRO_ONLY_TASKS), so Candel never dead-ends on a 403
 * for a regular account.
 */
const ACTION_TASKS: Record<string, { task: AITask; question: (s: string, tf: string) => string }> = {
    market: {
        task: "FAST_MARKET_CLASSIFICATION",
        question: (s, tf) => `Summarize the current market state for ${s} ${tf}: regime, volatility, and the dominant flow.`,
    },
    setup: {
        task: "SETUP_VALIDATION",
        question: (s, tf) => `Validate any active setup on ${s} ${tf}: trigger, invalidation, and follow-through odds.`,
    },
    structure: {
        task: "SIGNAL_EXPLANATION",
        question: (s, tf) => `Explain the market structure on ${s} ${tf}: trend, swing points, and the levels that matter.`,
    },
    risk: {
        task: "PRO_SCALPING_DECISION",
        question: (s, tf) => `Assess the risk of an entry on ${s} ${tf}: invalidation, size bounds, and conditions to stand down.`,
    },
    move: {
        task: "SIGNAL_EXPLANATION",
        question: (s, tf) => `Explain the current move on ${s} ${tf}: what drove it, and whether it looks exhaustive.`,
    },
    position: {
        task: "TRADE_REVIEW",
        question: (s, tf) => `Review position management for ${s} ${tf}: exits, trailing, and the risk actually taken.`,
    },
    compare: {
        task: "STRATEGY_RANKING",
        question: (s, tf) => `Rank the plausible strategies for ${s} ${tf} right now and justify the order.`,
    },
    proposal: {
        task: "PRO_SCALPING_DECISION",
        question: (s, tf) => `Prepare a trade proposal for ${s} ${tf}: entry, invalidation, targets, and confidence.`,
    },
};

/**
 * Turn an action string from `CandelQuickActions` (`"quick: market"`, …) into
 * a real /api/ai/analyze request. Unknown actions return null — the terminal
 * routes nothing instead of fabricating a response.
 */
export function candelActionRequest(
    action: string,
    symbol: string,
    timeframe: string,
): CandelActionRequest | null {
    const key = action.startsWith("quick: ") ? action.slice("quick: ".length) : action;
    const entry = ACTION_TASKS[key];
    if (!entry) return null;
    return { task: entry.task, question: entry.question(symbol, timeframe) };
}
