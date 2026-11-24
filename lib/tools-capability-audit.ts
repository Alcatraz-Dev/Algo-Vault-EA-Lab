/**
 * Paid-tool capability audit — the registry of record for every quantitative
 * capability the platform advertises as a Pro entitlement.
 *
 * Status vocabulary (deliberately narrow):
 *   IMPLEMENTED            a real execution path exists and is exercised; the
 *                          `implementation` field names it
 *   PARTIALLY_IMPLEMENTED  an engine or a piece of the capability exists, but
 *                          the advertised end-to-end surface does not
 *   NOT_IMPLEMENTED        no implementation exists anywhere in the repo
 *   UNAVAILABLE            an engine exists but cannot run for this capability
 *                          (e.g. Monte Carlo without real trade data)
 *
 * `advertisableFeature()` is the enforcement point: features classified
 * NOT_IMPLEMENTED or UNAVAILABLE are not rendered as Pro entitlements. The
 * audit test (`lib/tools-capability-audit.test.ts`) fails when a catalog entry
 * advertises a capability that is not registered here.
 *
 * Adding a paid capability therefore requires two edits: the implementation,
 * and this registry. Marketing copy alone cannot create a paid feature.
 */

export type CapabilityStatus =
    | "IMPLEMENTED"
    | "PARTIALLY_IMPLEMENTED"
    | "NOT_IMPLEMENTED"
    | "UNAVAILABLE";

export interface CapabilityAuditEntry {
    /** Stable id used by tests and telemetry. */
    id: string;
    /** Exact advertised string (as written in the catalog / tool page). */
    label: string;
    status: CapabilityStatus;
    /** Real code path(s) that back the capability. */
    implementation: string[];
    notes?: string;
}

export const CAPABILITY_AUDIT: readonly CapabilityAuditEntry[] = [
    // ── Quantitative validation (Milestone 3) ───────────────────────────────
    {
        id: "deflated-sharpe",
        label: "Deflated Sharpe Ratio",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/validation/dsr.ts"],
        notes: "Multiple-testing-adjusted Sharpe; requires recorded trials and trial-Sharpe variance.",
    },
    {
        id: "pbo-cscv",
        label: "Probability of Backtest Overfitting",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/validation/pbo.ts"],
        notes: "CSCV over a performance matrix of configurations; deterministic enumeration and tie-breaking.",
    },
    {
        id: "purged-cv",
        label: "Purged cross-validation with embargo",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/validation/purged-cv.ts", "lib/strategy-lab/validation-quant.ts"],
    },
    {
        id: "cpcv",
        label: "Combinatorial Purged Cross-Validation",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/validation/purged-cv.ts"],
    },
    {
        id: "cointegration",
        label: "Cointegration testing",
        status: "NOT_IMPLEMENTED",
        implementation: [],
        notes: "Zero implementations in the repository (lib/ and app/). Deferred; must not be advertised.",
    },
    {
        id: "var",
        label: "Value at Risk",
        status: "NOT_IMPLEMENTED",
        implementation: [],
        notes: "No VaR implementation exists. Deferred.",
    },

    // ── Risk of Ruin tool ──────────────────────────────────────────────────
    {
        id: "kelly",
        label: "Kelly criterion & half-Kelly position sizing",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/risk-of-ruin.ts#kellyResult", "app/tools/risk-of-ruin/page.tsx"],
    },
    {
        id: "ev-per-trade",
        label: "Expected value per trade in $",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/risk-of-ruin.ts#expectedValuePerTrade", "app/tools/risk-of-ruin/page.tsx"],
    },
    {
        id: "mc-ruin",
        label: "Monte-Carlo ruin distribution (1000 paths)",
        status: "IMPLEMENTED",
        implementation: ["lib/quant/risk-of-ruin.ts#simulateRuin", "app/tools/risk-of-ruin/page.tsx"],
        notes: "Deterministic seeded simulation (default 1000 paths × 500 trades).",
    },

    // ── Drawdown calculator ────────────────────────────────────────────────
    {
        id: "mc-drawdown",
        label: "Monte-Carlo drawdown distribution (1000 paths)",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["lib/market-intelligence/research/monte-carlo/runner.ts"],
        notes: "The engine exists for real trade lists; the drawdown tool has no trade data, so the advertised tool-level distribution is not wired.",
    },
    {
        id: "variable-loss",
        label: "Variable loss-per-trade (different size per trade)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "equity-csv",
        label: "Equity-curve export to CSV",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "compare-scenarios",
        label: "Compare two scenarios side-by-side",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },

    // ── Tool-page Pro conveniences (verified absent) ───────────────────────
    {
        id: "save-scenarios",
        label: "Save scenarios to your account",
        status: "NOT_IMPLEMENTED",
        implementation: [],
        notes: "No persistence path for tool scenarios (no RTDB write, no localStorage).",
    },
    {
        id: "save-presets",
        label: "Save calculator presets to your account",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-correlation",
        label: "Save correlation snapshots to your account",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-snapshots",
        label: "Save snapshots to your account",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-brokers",
        label: "Save broker shortlist",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-favorites",
        label: "Save favorites",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-templates",
        label: "Save templates (high+low pair)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-templates-2",
        label: "Save templates for repeated setups",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-overlap",
        label: "Save overlap schedule to your account",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "save-sessions",
        label: "Save your preferred sessions",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "csv-export",
        label: "Export to CSV",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "levels-export",
        label: "Export levels to clipboard with metadata",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "ics-export",
        label: "Calendar export (.ics)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },

    // ── Tool-page Pro analyses (engine exists, tool surface does not) ──────
    {
        id: "rolling-window",
        label: "Rolling window selector (7d / 30d / 90d)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "rolling-window-2",
        label: "Choose the rolling window (7d / 30d / 90d)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "correlation-heatmap",
        label: "Heatmap & intraday refresh",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["app/tools/correlation/page.tsx"],
        notes: "The matrix is colour-coded; no intraday refresh is wired.",
    },
    {
        id: "mtf-strength",
        label: "MTF strength (M15 / H1 / H4 / D1)",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["lib/analytics/multi-timeframe.ts"],
        notes: "Analysis helper exists; the tool page renders a single timeframe.",
    },
    {
        id: "mtf-strength-2",
        label: "MTF currency strength (M15, H1, H4, D1)",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["lib/analytics/multi-timeframe.ts"],
    },
    {
        id: "strength-divergence",
        label: "Strength divergence detector (one strong vs another)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "pair-heatmap",
        label: "Pair-strength heatmap",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "session-alerts",
        label: "Live session alerts (push / Telegram)",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["lib/notifications.ts", "lib/telegram-monitoring.ts"],
        notes: "Notification infrastructure exists; the sessions tool does not emit session alerts.",
    },
    {
        id: "session-pairs",
        label: "Session-by-session pair recommendation",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "session-history",
        label: "Historical session performance",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "overlap-suggestions",
        label: "Best-window pair suggestions (highest volatility)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "overlap-strength",
        label: "Per-pair overlap strength",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["app/tools/overlap/page.tsx"],
        notes: "Static overlap windows only; no per-pair measurement.",
    },
    {
        id: "custom-pair",
        label: "Custom pair calculator (any quote / base)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "cross-pair-matrix",
        label: "Cross-pair pip matrix",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "lot-conversion",
        label: "Per-instrument lot conversion",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["app/tools/pip-reference/page.tsx"],
    },
    {
        id: "cost-projection",
        label: "Side-by-side cost projection per trade size",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["app/tools/broker-fees/page.tsx"],
    },
    {
        id: "account-ranking",
        label: "Account-aware ranking (your volume / pairs)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "swap-comparison",
        label: "Rollover / swap comparison",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "margin-calc",
        label: "Margin calculator (per instrument, leverage aware)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "swap-calc",
        label: "Swap cost calculator (multi-day carry)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "profit-split",
        label: "Profit Split calculator (investor / manager)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "spread-analyzer",
        label: "Spread analyzer (pips, $ cost, % of price)",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "auto-swing",
        label: "Auto swing high / low from a live chart",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
    {
        id: "extension-targets",
        label: "Extension targets (1.272 → 4.236)",
        status: "PARTIALLY_IMPLEMENTED",
        implementation: ["app/tools/fibonacci/page.tsx"],
    },
    {
        id: "tp-suggestions",
        label: "Extension targets with TP suggestions",
        status: "NOT_IMPLEMENTED",
        implementation: [],
    },
];

const BY_LABEL = new Map<string, CapabilityAuditEntry>(CAPABILITY_AUDIT.map((e) => [e.label, e]));

export function lookupCapability(label: string): CapabilityAuditEntry | undefined {
    return BY_LABEL.get(label.trim());
}

/**
 * Only capabilities with a real execution path may be presented as Pro
 * entitlements. Unregistered strings pass through: the registry audits what was
 * reviewed, and the catalog test guarantees new catalog claims are registered.
 */
export function advertisableFeature(label: string): boolean {
    const entry = BY_LABEL.get(label.trim());
    if (!entry) return true;
    return entry.status === "IMPLEMENTED";

}

/** Filter a list of advertised features down to what is actually operational. */
export function advertisableFeatures(features: readonly string[] | undefined): string[] {
    return (features ?? []).filter(advertisableFeature);
}

export interface CapabilityAuditSummary {
    implemented: number;
    partial: number;
    missing: number;
    unavailable: number;
    total: number;
}

export function capabilityAuditSummary(): CapabilityAuditSummary {
    const count = (status: CapabilityStatus) => CAPABILITY_AUDIT.filter((e) => e.status === status).length;
    return {
        implemented: count("IMPLEMENTED"),
        partial: count("PARTIALLY_IMPLEMENTED"),
        missing: count("NOT_IMPLEMENTED"),
        unavailable: count("UNAVAILABLE"),
        total: CAPABILITY_AUDIT.length,
    };
}
