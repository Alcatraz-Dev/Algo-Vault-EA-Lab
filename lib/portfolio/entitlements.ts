/**
 * AlgoVault — Portfolio Intelligence entitlements (Phase 15 §47).
 *
 * Portfolio intelligence is a Pro capability with a deliberately useful Free
 * slice. The commercial rule lives here as DATA, not as `if (plan === "pro")`
 * scattered across routes — routes ask "is this feature granted?" and the
 * answer is read from this table.
 */

export const PORTFOLIO_FEATURES = [
    "portfolio.basic",          // equity, PnL, drawdown, position count
    "portfolio.exposure",       // basic gross/net/symbol exposure
    "portfolio.risk",           // basic risk summary
    "portfolio.correlation",    // correlation matrix
    "portfolio.concentration",  // full concentration axes
    "portfolio.strategies",     // strategy-to-portfolio intelligence
    "portfolio.risk_budgets",   // configurable risk budgets
    "portfolio.stress",         // stress testing
    "portfolio.monte_carlo",    // portfolio Monte Carlo
    "portfolio.allocation",     // capital allocation recommendations
    "portfolio.agents",         // portfolio agents
    "portfolio.memory",         // portfolio memory
    "portfolio.automation",     // advanced automation triggers/actions
    "portfolio.api",            // advanced portfolio API
] as const;

export type PortfolioFeature = (typeof PORTFOLIO_FEATURES)[number];

export const FREE_PORTFOLIO_FEATURES: readonly PortfolioFeature[] = [
    "portfolio.basic",
    "portfolio.exposure",
    "portfolio.risk",
];

export const PRO_PORTFOLIO_FEATURES: readonly PortfolioFeature[] = PORTFOLIO_FEATURES;

export function hasPortfolioFeature(plan: string, feature: PortfolioFeature): boolean {
    const normalized = String(plan || "free").toLowerCase();
    if (normalized === "enterprise" || normalized === "dev_pro" || normalized === "dev_enterprise") return true;
    if (normalized === "pro" || normalized === "elite") return PRO_PORTFOLIO_FEATURES.includes(feature);
    return FREE_PORTFOLIO_FEATURES.includes(feature);
}

/** Features that must be removed from a Free response rather than merely hidden. */
export function isProOnly(feature: PortfolioFeature): boolean {
    return PRO_PORTFOLIO_FEATURES.includes(feature) && !FREE_PORTFOLIO_FEATURES.includes(feature);
}

export interface PortfolioEntitlementResult {
    plan: string;
    allowed: PortfolioFeature[];
    denied: PortfolioFeature[];
    /** Explains to the user exactly what they are missing and why. */
    upgradeRequiredFor: PortfolioFeature[];
}

export function portfolioEntitlements(plan: string): PortfolioEntitlementResult {
    const allowed = PORTFOLIO_FEATURES.filter((f) => hasPortfolioFeature(plan, f));
    const denied = PORTFOLIO_FEATURES.filter((f) => !allowed.includes(f));
    return {
        plan,
        allowed,
        denied,
        upgradeRequiredFor: denied,
    };
}
