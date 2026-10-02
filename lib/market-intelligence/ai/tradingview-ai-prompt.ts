/**
 * AI Terminal prompt composition (PHASE 5).
 *
 * Builds the system + user prompts for multi-source analysis while preserving
 * the existing evidence-only AI boundary (phase12/ai-boundary.ts): the AI may
 * interpret relationships between evidence but must never invent evidence,
 * prices, classifications or BUY/SELL instructions.
 */
import type { MultiSourceIntelligenceResult } from "./external-intelligence-service";

export const TRADINGVIEW_AI_BOUNDARY_RULES = [
    "Separate your answer into the exact sections: ALGOVAULT EVIDENCE, TRADINGVIEW EVIDENCE, AI INTERPRETATION, LIMITATIONS.",
    "Only cite values that appear in the evidence provided; never invent prices, levels, indicator readings or classifications.",
    "TradingView evidence is external and may be delayed — never treat it as real-time or use it for execution decisions.",
    "Do not merge TradingView observations with AlgoVault observations; keep provenance explicit.",
    "Do not produce BUY/SELL instructions or trade calls; describe relationships and context only.",
    "When evidence is unavailable, say so explicitly in LIMITATIONS instead of filling gaps.",
] as const;

export function buildTradingViewSystemPrompt(): string {
    return [
        "You are AlgoVault AI, the analysis layer of the AlgoVault trading intelligence platform.",
        "You receive evidence from two clearly separated sources:",
        "  1. ALGOVAULT EVIDENCE — deterministic output of AlgoVault's own engines (Smart Money structure, liquidity, FVG, order blocks, MTF confluence, Setup Memory, backtests).",
        "  2. TRADINGVIEW EVIDENCE — optional external context from the TradingView MCP provider (technical snapshot, news, economic calendar). It may be delayed and is context only.",
        "",
        "Rules:",
        ...TRADINGVIEW_AI_BOUNDARY_RULES.map((r) => `- ${r}`),
    ].join("\n");
}

export interface BuildTradingViewUserPromptInput {
    symbol: string;
    timeframe: string;
    question?: string;
    algovaultEvidenceText: string;
    external: MultiSourceIntelligenceResult;
}

export function buildTradingViewUserPrompt(input: BuildTradingViewUserPromptInput): string {
    const lines: string[] = [];
    lines.push(`Symbol: ${input.symbol}`);
    lines.push(`Timeframe: ${input.timeframe}`);
    lines.push("");
    lines.push("ALGOVAULT EVIDENCE (deterministic engine output):");
    lines.push(input.algovaultEvidenceText || "- (no AlgoVault engine output available)");
    lines.push("");
    lines.push(input.external.aiEvidenceText);
    lines.push("");
    if (input.question) {
        lines.push(`User question: ${input.question}`);
        lines.push("");
    }
    lines.push("Respond with exactly these sections:");
    lines.push("ALGOVAULT EVIDENCE");
    lines.push("TRADINGVIEW EVIDENCE");
    lines.push("AI INTERPRETATION");
    lines.push("LIMITATIONS");
    return lines.join("\n");
}
