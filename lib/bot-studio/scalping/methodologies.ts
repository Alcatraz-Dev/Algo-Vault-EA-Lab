/**
 * AlgoVault — scalping methodology trace.
 *
 * The Skills Registry (`lib/skills/registry`) is the authority for which
 * methodologies the platform may claim. This module maps each part of the
 * scalping bot's decision path to the registry record that actually backs it,
 * and to the AlgoVault function that consumes it.
 *
 * It is a TRACE, not marketing: a record is reported as
 *   • "active"          only when the named implementation is on the bot's
 *                       decision/execution path;
 *   • "available"       when the skill is registered and enabled but this bot
 *                       does not call it;
 *   • "unavailable"     when the registry has no such record, or it is
 *                       disabled.
 *
 * Nothing is inferred from a doc or a blog post, and no third-party code is
 * imported: the registry rejects external records that carry broker
 * credentials, execution permissions or imported code.
 */

import { getSkillsRegistry, type SkillRecord } from "@/lib/skills/registry";

export type MethodologyStatus = "active" | "available" | "unavailable";

export interface MethodologyTrace {
    /** Registry skill id. */
    skillId: string;
    label: string;
    status: MethodologyStatus;
    /** AlgoVault implementation actually consumed by the bot path. */
    implementation: string;
    /** Where in the scalping path it is consumed. */
    stage: "signal" | "validation" | "risk" | "execution";
    note: string;
}

/**
 * Skills the scalping path genuinely consumes.
 *
 * - signal:     evaluateEntry via buildSeriesMap (same core as the backtest)
 * - risk:       evaluateGate → evaluateOrder (canonical risk engine); the
 *               latched breaker is read by loadAccountRiskSnapshot
 * - execution:  UnifiedTradingService duplicate guard uses
 *               computeOrderIdentity / the notional ledger reservation
 * - validation: Strategy Lab backtest is the parity reference for live signals
 */
const ACTIVE_CONSUMERS: Array<{
    skillId: string;
    label: string;
    stage: MethodologyTrace["stage"];
    implementation: string;
    note: string;
}> = [
    {
        skillId: "backtest.strategy-lab",
        label: "Strategy Lab backtest parity",
        stage: "signal",
        implementation: "lib/strategy-engine/decisions.ts (evaluateEntry) via lib/strategy-lab/backtest.ts",
        note: "Live scalping signals call the same entry evaluator as the backtest — no separate live rule set.",
    },
    {
        skillId: "risk.engine",
        label: "Canonical risk engine",
        stage: "risk",
        implementation: "lib/risk/risk-engine.ts (evaluateOrder) via lib/ai-execution/gate.ts",
        note: "Every scalping entry is evaluated by the canonical engine inside the AI Execution Gate.",
    },
    {
        skillId: "risk.drawdown-breaker",
        label: "Latched drawdown breaker",
        stage: "risk",
        implementation: "lib/risk/drawdown-breaker.ts via lib/risk/account-state.ts",
        note: "A TRIPPED breaker is read into AccountRiskState and blocks entries until an audited reset; pacing re-checks it.",
    },
    {
        skillId: "execution.order-fingerprint",
        label: "Order fingerprint / duplicate guard",
        stage: "execution",
        implementation: "lib/risk/order-fingerprint.ts via lib/trading/unified/service.ts",
        note: "The unified service rejects economically identical orders; the bot adds deterministic execution ids per bar.",
    },
];

/**
 * Skills registered for validation that this bot does NOT apply at runtime.
 * They are reported as "available" so nobody can claim the bot ran PBO or a
 * purged CV when it did not.
 */
const AVAILABLE_ONLY: Array<{ skillId: string; label: string; note: string }> = [
    {
        skillId: "validation.walk-forward",
        label: "Walk-forward validation",
        note: "Available in Strategy Lab; the scalping bot does not run it automatically.",
    },
    {
        skillId: "validation.pbo-cscv",
        label: "Probability of backtest overfitting (CSCV)",
        note: "Available in the quant pipeline; not executed by the bot.",
    },
    {
        skillId: "validation.purged-cv",
        label: "Purged cross-validation / embargo",
        note: "Available in the quant pipeline; not executed by the bot.",
    },
    {
        skillId: "validation.deflated-sharpe",
        label: "Deflated Sharpe ratio",
        note: "Available in the quant pipeline; not executed by the bot.",
    },
];

/**
 * Methodologies referenced in the earlier trading-skills review that the
 * registry does NOT hold. They are deliberately reported as unavailable rather
 * than silently omitted — a gap must be visible.
 */
const NOT_REGISTERED: Array<{ skillId: string; label: string; note: string }> = [
    {
        skillId: "methodology.market-structure",
        label: "Market-structure methodology (swing/BOS/CHoCH)",
        note: "Structure features exist in the feature engine, but no registry record approves a named external methodology — reported as unavailable.",
    },
    {
        skillId: "methodology.fill-simulation",
        label: "Pre-trade fill simulation",
        note: "Fill simulation exists only inside the backtest execution model; no registry record covers live pre-trade fills.",
    },
];

function statusOf(record: SkillRecord | null): MethodologyStatus {
    if (!record || !record.enabled) return "unavailable";
    return "available";
}

/** Build the trace for the current process registry. */
export function scalpingMethodologyTrace(): MethodologyTrace[] {
    const registry = getSkillsRegistry();
    const traces: MethodologyTrace[] = [];

    for (const consumer of ACTIVE_CONSUMERS) {
        const record = registry.get(consumer.skillId);
        traces.push({
            skillId: consumer.skillId,
            label: consumer.label,
            status: record && record.enabled ? "active" : "unavailable",
            implementation: consumer.implementation,
            stage: consumer.stage,
            note:
                record && record.enabled
                    ? consumer.note
                    : `Skill "${consumer.skillId}" is missing or disabled in the Skills Registry — the bot path must be treated as unverified.`,
        });
    }

    for (const entry of AVAILABLE_ONLY) {
        const record = registry.get(entry.skillId);
        traces.push({
            skillId: entry.skillId,
            label: entry.label,
            status: statusOf(record),
            implementation: record?.source.reference ?? "not registered",
            stage: "validation",
            note: entry.note,
        });
    }

    for (const entry of NOT_REGISTERED) {
        traces.push({
            skillId: entry.skillId,
            label: entry.label,
            status: "unavailable",
            implementation: "not implemented for this bot",
            stage: "signal",
            note: entry.note,
        });
    }

    return traces;
}

/** True when every skill the bot depends on is present and enabled. */
export function scalpingMethodologiesVerified(): boolean {
    return scalpingMethodologyTrace()
        .filter((t) => ACTIVE_CONSUMERS.some((c) => c.skillId === t.skillId))
        .every((t) => t.status === "active");
}
