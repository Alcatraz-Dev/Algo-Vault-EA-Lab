/**
 * Product Analytics — Pro value catalogue.
 *
 * When a Free user reaches a Pro capability we do not simply block them. This
 * module is the single source of truth for WHAT the Pro plan adds to that
 * specific workflow, so the gate can explain real value instead of saying
 * "Upgrade to unlock AI magic".
 *
 * Every entry names:
 *  - the workflow the user was in,
 *  - the concrete capabilities Pro adds,
 *  - a route where the user can SEE those capabilities before paying.
 *
 * This is a catalogue, not a pricing promise: it does not state prices, and
 * every capability listed here maps to a route that actually exists in the app.
 *
 * Pure module: no I/O.
 */

export const PRO_VALUE_POINTS = {
  "strategy-research": {
    title: "Strategy Research",
    /** The Free-tier limits, described honestly rather than as a teaser. */
    freeIncludes: "Basic backtests with standard metrics",
    adds: [
      "Out-of-sample testing",
      "Walk-forward analysis",
      "Monte Carlo simulation",
      "Parameter stability checks",
    ],
    /** Where a Free user can see what Pro research looks like. */
    exampleRoute: "/strategy-research",
  },
  "monte-carlo": {
    title: "Monte Carlo Simulation",
    freeIncludes: "Deterministic backtest results",
    adds: [
      "Randomised trade-order resampling",
      "Drawdown distribution across thousands of runs",
      "Risk-of-ruin estimates",
      "Equity-curve confidence bands",
    ],
    exampleRoute: "/monte-carlo",
  },
  "walk-forward": {
    title: "Walk-Forward Analysis",
    freeIncludes: "Single-window backtests",
    adds: [
      "Rolling in-sample / out-of-sample windows",
      "Per-window performance degradation",
      "Optimisation-vs-validation split",
    ],
    exampleRoute: "/walk-forward",
  },
  backtesting: {
    title: "Professional Backtesting",
    freeIncludes: "Basic backtests with standard metrics",
    adds: [
      "Out-of-sample validation",
      "Monte Carlo robustness",
      "Strategy health scoring",
      "Strategy memory across sessions",
    ],
    exampleRoute: "/backtests",
  },
  "market-intelligence": {
    title: "Market Intelligence",
    freeIncludes: "Basic chart and indicator overlays",
    adds: [
      "Multi-timeframe confluence",
      "Liquidity and structure analysis",
      "Session and regime detection",
      "AI interpretation of the same data",
    ],
    exampleRoute: "/market-intelligence",
  },
  "ai-analysis": {
    title: "AI Market Analysis",
    freeIncludes: "Limited AI analysis runs",
    adds: [
      "Unlimited structured analysis",
      "Setup context and reasoning",
      "Historical similarity search",
      "Analysis across all supported symbols",
    ],
    exampleRoute: "/market-intelligence/analysis",
  },
  "smart-money": {
    title: "Smart Money Setups",
    freeIncludes: "Basic smart money overlays",
    adds: [
      "Advanced liquidity-sweep detection",
      "FVG and structure confluence",
      "Setup memory and alerts",
    ],
    exampleRoute: "/market-intelligence/smart-money",
  },
  "trade-journal": {
    title: "Trade Journal",
    freeIncludes: "Basic journal entries",
    adds: [
      "Automatic trade import and tagging",
      "Discipline scoring across your history",
      "Pattern detection in your own behaviour",
    ],
    exampleRoute: "/trade-journal",
  },
  automation: {
    title: "Workflow Automation",
    freeIncludes: "Basic workflows",
    adds: [
      "Advanced triggers and conditions",
      "Scheduled research runs",
      "Alert-to-workflow chaining",
    ],
    exampleRoute: "/workflows",
  },
  marketplace: {
    title: "Strategy Marketplace",
    freeIncludes: "Browsing certified strategies",
    adds: [
      "Full due-diligence reports",
      "Strategy health and robustness scores",
      "Supported symbols and risk profile",
    ],
    exampleRoute: "/marketplace",
  },
  "intelligence-api": {
    title: "Intelligence API",
    freeIncludes: "—",
    adds: [
      "Programmatic market intelligence",
      "Research API access",
      "Webhooks for signals and alerts",
      "Higher rate limits",
    ],
    exampleRoute: "/developer/intelligence-cloud",
  },
  "strategy-health": {
    title: "Strategy Health",
    freeIncludes: "—",
    adds: [
      "Live degradation monitoring",
      "Robustness score over time",
      "Automated re-research when a strategy drifts",
    ],
    exampleRoute: "/strategy-lab",
  },
  "setup-memory": {
    title: "Setup Memory",
    freeIncludes: "—",
    adds: [
      "Persistent setup history",
      "Outcome tracking for every setup",
      "Pattern reuse across symbols",
    ],
    exampleRoute: "/market-intelligence/smart-money",
  },
  pricing: {
    title: "AlgoVault Pro",
    freeIncludes: "Charts, basic analytics, educational content",
    adds: [
      "Advanced market intelligence",
      "Professional backtesting and research",
      "Out-of-sample, walk-forward and Monte Carlo",
      "Advanced automation and strategy health",
    ],
    exampleRoute: "/pricing",
  },
  other: {
    title: "AlgoVault Pro",
    freeIncludes: "Charts, basic analytics, educational content",
    adds: [
      "Advanced market intelligence",
      "Professional backtesting and research",
      "Out-of-sample, walk-forward and Monte Carlo",
      "Advanced automation and strategy health",
    ],
    exampleRoute: "/pricing",
  },
} as const;

export type ProValueKey = keyof typeof PRO_VALUE_POINTS;
export type ProValuePoint = (typeof PRO_VALUE_POINTS)[ProValueKey];

export function isProValueKey(value: unknown): value is ProValueKey {
    return typeof value === "string" && value in PRO_VALUE_POINTS;
}

export function getProValue(key: string): ProValuePoint {
    return PRO_VALUE_POINTS[isProValueKey(key) ? key : "other"];
}

/**
 * The full workflow-by-workflow plan comparison used on the pricing page.
 *
 * Deliberately expressed as WORKFLOWS rather than a giant feature list, and
 * deliberately honest about what Free already includes. `null` means "not
 * available on this plan" — we never write a vague dash that reads as a tease.
 */
export type PlanCapability = "full" | "limited" | "none";

export type WorkflowRow = {
    workflow: string;
    free: PlanCapability;
    pro: PlanCapability;
    developer: PlanCapability;
    /** Which route demonstrates the workflow. */
    route: string;
};

export const PLAN_COMPARISON: WorkflowRow[] = [
    { workflow: "Basic Chart & Indicators", free: "full", pro: "full", developer: "full", route: "/market-intelligence" },
    { workflow: "Smart Money Setups", free: "limited", pro: "full", developer: "full", route: "/market-intelligence/smart-money" },
    { workflow: "AI Market Analysis", free: "limited", pro: "full", developer: "full", route: "/market-intelligence/analysis" },
    { workflow: "Backtesting", free: "limited", pro: "full", developer: "full", route: "/backtests" },
    { workflow: "Strategy Research", free: "limited", pro: "full", developer: "full", route: "/strategy-research" },
    { workflow: "Walk-Forward & OOS", free: "none", pro: "full", developer: "full", route: "/walk-forward" },
    { workflow: "Monte Carlo", free: "none", pro: "full", developer: "full", route: "/monte-carlo" },
    { workflow: "Workflow Automation", free: "limited", pro: "full", developer: "full", route: "/workflows" },
    { workflow: "Trade Journal", free: "limited", pro: "full", developer: "full", route: "/trade-journal" },
    { workflow: "Strategy Health", free: "none", pro: "full", developer: "full", route: "/strategy-lab" },
    { workflow: "Marketplace Access", free: "limited", pro: "full", developer: "full", route: "/marketplace" },
    { workflow: "Intelligence API", free: "none", pro: "limited", developer: "full", route: "/developer/intelligence-cloud" },
    { workflow: "Webhooks", free: "none", pro: "none", developer: "full", route: "/developer/intelligence-cloud" },
    { workflow: "Strategy Certification", free: "none", pro: "none", developer: "full", route: "/marketplace/strategy-certification" },
];

export const PLAN_CAPABILITY_LABEL: Record<PlanCapability, string> = {
    full: "Included",
    limited: "Limited",
    none: "Not available",
};
