/**
 * Master Catalog — every public tool that ships on the platform, classified by
 * tier (Free / Lite vs Pro) with concrete feature gates.
 *
 * Single source of truth so:
 *   1. The pricing page can compare Lite vs Pro feature by feature
 *   2. The /tools landing page can render tier badges and feature lists
 *   3. Each tool page can show a consistent "what Pro adds" CTA
 *
 * Tiering rules:
 *   - "free"  → anyone (signed in or not) can use this tool, with the lite
 *               feature set. The page exposes basic math/visualizations only.
 *   - "pro"   → this tool — or its advanced surfaces — requires an active
 *               Pro subscription. We never lock math or signage at the data
 *               source; the gate is at the UI layer per PRODUCT.md rules.
 *
 * The "free" tool pages still expose value (the lite feature set is real and
 * useful); the Pro tier adds persistence, multi-symbol depth, automation,
 * replay, exports, and AI-assisted explanations.
 */

export type ToolTier = "free" | "pro";

export type ToolGroup =
    | "calculator"
    | "analysis"
    | "reference"
    | "market"
    | "terminal";

export type ToolCatalogEntry = {
    id: string;
    title: string;
    description: string;
    href: string;
    group: ToolGroup;
    tier: ToolTier;
    /** Optional Pro counterpart — a deeper / different tool path. */
    proHref?: string;
    /** Hero text used on the landing page and the Pro upgrade CTA. */
    proHeadline?: string;
    /** Concrete things that are gated behind Pro. */
    proFeatures: string[];
    /** What the free/lite version still gives the user. */
    liteFeatures: string[];
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
    // ─── Calculators (lite = single calc, pro = full suite) ──────────────────
    {
        id: "risk-calculator",
        title: "Risk Calculator",
        description:
            "Position size from balance, risk % and stop-loss.",
        href: "/tools/calculators",
        group: "calculator",
        tier: "free",
        proFeatures: [
            "Profit Split calculator (investor / manager share)",
            "Swap cost calculator (multi-day)",
            "Spread analyzer (pips, $ cost, % of price)",
            "Save calc presets to your account",
        ],
        liteFeatures: [
            "Position size from balance, risk %, SL",
            "Pip value per lot",
            "Risk amount in $",
        ],
    },
    {
        id: "drawdown-calculator",
        title: "Drawdown Calculator",
        description:
            "See how consecutive losses compound and what recovery requires.",
        href: "/tools/drawdown-calculator",
        group: "calculator",
        tier: "free",
        proFeatures: [
            "Monte-Carlo drawdown distribution",
            "Variable loss-per-trade scenarios",
            "Equity-curve export (CSV)",
            "Save scenarios to your account",
        ],
        liteFeatures: [
            "Compounding loss curve (fixed loss %)",
            "Recovery % needed to breakeven",
            "Visual equity curve",
        ],
    },
    {
        id: "risk-of-ruin",
        title: "Risk of Ruin",
        description:
            "Probability of blowing the account given win rate, RR and risk.",
        href: "/tools/risk-of-ruin",
        group: "calculator",
        tier: "free",
        proFeatures: [
            "Kelly criterion & half-Kelly position sizing",
            "Expected value per trade in $",
            "Monte-Carlo ruin distribution (1000 paths)",
            "Save scenarios to your account",
        ],
        liteFeatures: [
            "Single-point risk of ruin %",
            "Trades to double the account",
            "Max consecutive losses (expected)",
        ],
    },
    {
        id: "fibonacci",
        title: "Fibonacci Calculator",
        description:
            "Retracement and extension levels from any swing high / low.",
        href: "/tools/fibonacci",
        group: "calculator",
        tier: "free",
        proFeatures: [
            "Auto-pull swing high/low from a live chart",
            "Save templates (high+low pair)",
            "Export levels to clipboard with metadata",
            "Extension targets with TP suggestions",
        ],
        liteFeatures: [
            "Manual high / low input",
            "Standard retracement (0.236 → 0.786)",
            "Extension levels (1.0 → 4.236)",
        ],
    },
    {
        id: "pip-reference",
        title: "Pip Reference",
        description:
            "Pip size, value per lot and contract size for every instrument.",
        href: "/tools/pip-reference",
        group: "reference",
        tier: "free",
        proFeatures: [
            "Custom pair calculator (any quote / base)",
            "Per-instrument lot conversion",
            "Save favorites",
            "Cross-pair pip matrix",
        ],
        liteFeatures: [
            "Curated list of 18 majors / minors / metals / crypto / indices",
            "Category filter",
            "Copy row to clipboard",
        ],
    },
    {
        id: "broker-fees",
        title: "Broker Fee Comparison",
        description:
            "Compare spread, commission and rollover across brokers.",
        href: "/tools/broker-fees",
        group: "reference",
        tier: "free",
        proFeatures: [
            "Side-by-side cost projection per trade size",
            "Account-aware ranking (your volume / pairs)",
            "Save broker shortlist",
            "Rollover / swap comparison",
        ],
        liteFeatures: [
            "Read-only fee table",
            "Spread column per broker",
            "Commission column per broker",
        ],
    },
    {
        id: "correlation",
        title: "Correlation Matrix",
        description:
            "30-day daily-return correlation across the radar watchlist.",
        href: "/tools/correlation",
        group: "analysis",
        tier: "free",
        proFeatures: [
            "Choose the rolling window (7d / 30d / 90d)",
            "Save correlation snapshots to your account",
            "Export to CSV",
            "Heatmap & intraday intraday refresh",
        ],
        liteFeatures: [
            "Read the 30-day correlation matrix",
            "Color-coded strong / weak / neutral",
            "Strong-correlation warnings",
        ],
    },
    {
        id: "currency-strength",
        title: "Currency Strength",
        description:
            "Relative strength score for each major currency.",
        href: "/tools/currency-strength",
        group: "analysis",
        tier: "free",
        proFeatures: [
            "MTF currency strength (M15, H1, H4, D1)",
            "Strength divergence detector (one strong vs another)",
            "Save snapshots to your account",
            "Pair-strength heatmap",
        ],
        liteFeatures: [
            "Live single-TF strength read",
            "Ranked strongest / weakest",
            "Color scale",
        ],
    },
    {
        id: "sessions",
        title: "Trading Sessions",
        description:
            "Visual 24h band of Sydney / Tokyo / London / NY plus overlaps.",
        href: "/tools/sessions",
        group: "market",
        tier: "free",
        proFeatures: [
            "Live session alerts (push / Telegram)",
            "Session-by-session pair recommendation",
            "Save your preferred sessions",
            "Historical session performance",
        ],
        liteFeatures: [
            "Static 24h session grid",
            "Live UTC clock",
            "Active session highlights",
        ],
    },
    {
        id: "overlap",
        title: "Session Overlap Finder",
        description:
            "Find the highest-liquidity windows where sessions intersect.",
        href: "/tools/overlap",
        group: "market",
        tier: "free",
        proFeatures: [
            "Best-window pair suggestions (highest volatility)",
            "Save overlap schedule to your account",
            "Calendar export (.ics)",
            "Per-pair overlap strength",
        ],
        liteFeatures: [
            "Read overlap windows (London/NY etc.)",
            "Volatility tier per overlap",
            "Pairs list per overlap",
        ],
    },

    // ─── Pro-tier tools (terminal, market intelligence, automation) ───────
    {
        id: "free-ai-scalping-terminal",
        title: "AI Scalping Terminal (Free)",
        description:
            "Live market radar, deterministic trade intelligence and engine feed. Free forever.",
        href: "/scalping-terminal",
        group: "terminal",
        tier: "free",
        proHref: "/account/scalping-terminal",
        proHeadline:
            "Pro Scalping Terminal adds the full chart, overlays, replay, order flow, intelligence and trade journaling to the same signal pipeline.",
        proFeatures: [
            "Full TradingView-grade chart with drawings + layers",
            "Smart Money / FVG / Order Block overlays",
            "Historical replay (no future leakage)",
            "Order Flow panel with GEX where available",
            "AI Intelligence fabric (decision state)",
            "Trade Journal tied to every logged signal",
            "TradingView context integration",
        ],
        liteFeatures: [
            "Live market radar over 5 symbols",
            "Live trade-intelligence signals",
            "Engine feed (full audit trail)",
            "Deterministic engine (no AI spend)",
        ],
    },
    {
        id: "advanced-analysis",
        title: "Advanced Analysis Terminal",
        description:
            "Pro chart workspace with overlays, replay, order flow and intelligence.",
        href: "/advanced-analysis",
        group: "terminal",
        tier: "pro",
        proHeadline:
            "Everything in the AI Scalping Terminal, plus the full Pro chart workspace.",
        proFeatures: [
            "Full TradingView-grade chart",
            "All Smart Money overlays + indicator set",
            "Replay + walk-through history",
            "Order Flow + GEX",
            "Intelligence Fabric (confidence, Jev, decision state)",
            "Trade Journal + Analytics",
        ],
        liteFeatures: [],
    },
    {
        id: "market-intelligence",
        title: "Market Intelligence",
        description:
            "Command center for analysis, evidence, backtest and strategy.",
        href: "/market-intelligence",
        group: "analysis",
        tier: "pro",
        proHeadline:
            "Deep research layer with evidence-cited deterministic outputs and AI interpretation.",
        proFeatures: [
            "Command center + workspace context",
            "Evidence-cited research panel",
            "Backtest + replay integration",
            "Strategy Lab handoff",
            "AI-assisted interpretation",
        ],
        liteFeatures: [],
    },
    {
        id: "copy-trading",
        title: "Copy Trading",
        description:
            "Mirror risk-scaled strategies into your own broker account.",
        href: "/copy-trading",
        group: "terminal",
        tier: "pro",
        proFeatures: [
            "Risk-scaled mirroring (5 masters on Pro, ∞ on Enterprise)",
            "Verified-only masters filter",
            "Allocation caps per master",
            "Real-time drawdown guard",
        ],
        liteFeatures: [],
    },
    {
        id: "strategy-lab",
        title: "Strategy Lab",
        description:
            "Build visual strategies, run backtests, walk-forward and replay.",
        href: "/strategy-lab",
        group: "analysis",
        tier: "pro",
        proFeatures: [
            "Visual strategy builder",
            "Backtest with spread / slippage / commission",
            "Walk-forward validation",
            "Monte Carlo robustness",
            "EA export (MQL5)",
        ],
        liteFeatures: [],
    },
];

export const TOOL_BY_ID = Object.fromEntries(
    TOOL_CATALOG.map((tool) => [tool.id, tool]),
) as Record<string, ToolCatalogEntry>;

export function getToolsByTier(tier: ToolTier): ToolCatalogEntry[] {
    return TOOL_CATALOG.filter((t) => t.tier === tier);
}

export function getToolsByGroup(group: ToolGroup): ToolCatalogEntry[] {
    return TOOL_CATALOG.filter((t) => t.group === group);
}