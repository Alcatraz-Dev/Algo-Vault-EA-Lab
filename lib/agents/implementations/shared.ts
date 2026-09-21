import {
    AgentEvidence,
    AgentFinding,
    AgentOutput,
    WorkflowContext,
} from "../types";

/**
 * Shared helpers for agent implementations.
 *
 * Agents build their outputs from measured context only. The helpers here
 * keep rounding, evidence bookkeeping and confidence conventions identical
 * across the built-in agent set.
 */

export function round(value: number, digits = 2): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function hourLabel(ts: number): string {
    if (!ts) return "unknown";
    return new Date(ts).toUTCString().slice(17, 22) + " UTC";
}

export function sessionLabel(hourUtc: number): string {
    if (hourUtc >= 0 && hourUtc < 7) return "Asian";
    if (hourUtc >= 7 && hourUtc < 13) return "London";
    if (hourUtc >= 13 && hourUtc < 21) return "New York";
    return "Off-hours";
}

export const REGIME_LABEL: Record<string, string> = {
    trending_bullish: "Trending bullish",
    trending_bearish: "Trending bearish",
    ranging: "Ranging / consolidating",
    breakout: "Breakout",
    high_volatility: "High volatility",
    low_volatility: "Low volatility",
    transitional: "Transitional",
};

export function regimeLabel(regime: string | undefined): string {
    return (regime && REGIME_LABEL[regime]) || String(regime || "unknown");
}

export function upper(str: string | undefined): string {
    return String(str || "").trim().toLowerCase();
}

/**
 * Reads a typed market snapshot out of the shared context. The context is
 * modelled loosely (Record<string, unknown>) so implementations stay
 * decoupled from the plugin runtime's concrete snapshot type.
 */
export function snapshotOf(
    context: WorkflowContext,
    symbol: string | undefined
): Record<string, any> | null {
    if (!symbol) return null;
    const market = context.market || {};
    const snap = market[symbol.toUpperCase()];
    return snap && typeof snap === "object" ? (snap as Record<string, any>) : null;
}

export function firstSnapshot(
    context: WorkflowContext
): { symbol: string; snap: Record<string, any> } | null {
    const market = context.market || {};
    const entries = Object.entries(market);
    if (entries.length === 0) return null;
    for (const [symbol, raw] of entries) {
        if (raw && typeof raw === "object") {
            return { symbol, snap: raw as Record<string, any> };
        }
    }
    return null;
}

// ─── Evidence builder ───────────────────────────────────────────────────────

let evidenceCounter = 0;

/**
 * Creates an evidence record that MUST reference a real data source listed
 * in `dataUsed`. Agents should call `addEvidence` and include the returned
 * id in `dataUsed` to keep the "no invented evidence" rule enforceable.
 */
export function addEvidence(
    collection: AgentEvidence[],
    dataUsed: string[],
    input: Omit<AgentEvidence, "id">
): string {
    const id = `ev_${input.dataUsed.replace(/[^A-Za-z0-9]/g, "_").slice(-24)}_${(evidenceCounter++).toString(36)}`;
    collection.push({ id, dataUsed: input.dataUsed, value: input.value, note: input.note });
    if (!dataUsed.includes(input.dataUsed)) {
        dataUsed.push(input.dataUsed);
    }
    return id;
}

// ─── Output constructors ────────────────────────────────────────────────────

export function successOutput(input: {
    agentId: string;
    summary: string;
    confidence?: number;
    findings?: AgentFinding[];
    evidence?: AgentEvidence[];
    dataUsed?: string[];
    warnings?: string[];
    nextStep?: string;
    metadata?: Record<string, unknown>;
    aiEnhanced?: boolean;
}): AgentOutput {
    return {
        agentId: input.agentId,
        status: "success",
        confidence: clamp(Number(input.confidence) || 0, 0, 1),
        summary: input.summary,
        findings: input.findings || [],
        evidence: input.evidence || [],
        warnings: input.warnings || [],
        dataUsed: input.dataUsed || [],
        nextStep: input.nextStep || "",
        aiEnhanced: input.aiEnhanced,
        metadata: input.metadata,
    };
}

export function failureOutput(
    agentId: string,
    message: string,
    opts?: { nextStep?: string; dataUsed?: string[] }
): AgentOutput {
    return {
        agentId,
        status: "failed",
        confidence: 0,
        summary: message,
        findings: [],
        evidence: [],
        warnings: [],
        dataUsed: opts?.dataUsed || [],
        nextStep: opts?.nextStep || "",
        error: message,
    };
}

/**
 * Deterministic AI-gateway narrator gating (spec § "No fake AI outputs").
 * `hybrid` agents call `tryNarrate`; when the gateway is unavailable
 * (provider = local-heuristic) or an error occurs, narration is skipped and
 * the deterministic core result stands, clearly labelled so.
 */
export type NarrateResult = {
    ok: boolean;
    text?: string;
    provider?: string;
    model?: string;
    reason?: string;
};

export async function tryNarrate(
    prompt: string,
    systemPrompt: string,
    opts?: { maxTokens?: number }
): Promise<NarrateResult> {
    try {
        const [{ defaultRouter }, { AIConfig }] = await Promise.all([
            import("@/lib/ai/router"),
            import("@/lib/ai/config"),
        ]);
        // Never depend on an explicitly paid/unknown model for narration.
        const response = await defaultRouter.chat({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
            responseFormat: "text",
            maxTokens: opts?.maxTokens || 300,
            model: AIConfig.freeOnly ? undefined : AIConfig.defaultModel,
        });
        if (!response.success) {
            return { ok: false, reason: "AI gateway returned no content." };
        }
        if (response.provider === "local-heuristic") {
            return {
                ok: false,
                provider: response.provider,
                reason:
                    "AI providers are temporarily unavailable — deterministic analysis used instead.",
            };
        }
        return {
            ok: true,
            text: String(response.content || "").trim(),
            provider: response.provider,
            model: response.model,
        };
    } catch (err) {
        return {
            ok: false,
            reason: err instanceof Error ? err.message : "AI narration unavailable.",
        };
    }
}