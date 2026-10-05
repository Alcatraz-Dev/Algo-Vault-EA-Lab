/**
 * Trading capability rollout flags. Server-only by convention: do not import
 * this module into a client component or expose environment variables to NEXT_PUBLIC.
 * Unreleased execution and funded capabilities are hard-disabled even if an
 * environment variable is accidentally set to true.
 */

function envFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (["1", "true", "yes", "on", "enabled"].includes(raw)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(raw)) return false;
    return fallback;
}

export const TRADING_FLAG_ENV = {
    paperTrading: "ENABLE_PAPER_TRADING",
    challenges: "ENABLE_CHALLENGES",
    brokerConnections: "ENABLE_BROKER_CONNECTIONS",
    liveTrading: "ENABLE_LIVE_TRADING",
    fundedProgram: "ENABLE_FUNDED_PROGRAM",
    payouts: "ENABLE_PAYOUTS",
    // ── Unified Trading Service (provider-neutral layer) ────────────────────
    unifiedTrading: "UNIFIED_TRADING_ENABLED",
    mt5Demo: "MT5_DEMO_ENABLED",
    mt4Demo: "MT4_DEMO_ENABLED",
    cTraderDemo: "CTRADER_DEMO_ENABLED",
    tradingViewExecution: "TRADINGVIEW_EXECUTION_ENABLED",
    algoVaultBroker: "ALGOVAULT_BROKER_ENABLED",
    executionMode: "TRADING_EXECUTION_MODE",
} as const;

export function isPaperTradingEnabled(): boolean {
    return envFlag(TRADING_FLAG_ENV.paperTrading, true);
}

export function areChallengesEnabled(): boolean {
    return envFlag(TRADING_FLAG_ENV.challenges, false);
}

export function areBrokerConnectionsEnabled(): boolean {
    return false;
}

export function isBrokerConnectionsEnabled(): boolean {
    return areBrokerConnectionsEnabled();
}

export function isLiveTradingEnabled(): boolean {
    return false;
}

export function isFundedProgramEnabled(): boolean {
    return false;
}

export function arePayoutsEnabled(): boolean {
    return false;
}

export function tradingFlagSnapshot() {
    return {
        paperTradingEnabled: isPaperTradingEnabled(),
        challengesEnabled: areChallengesEnabled(),
        brokerConnectionsEnabled: areBrokerConnectionsEnabled(),
        fundedProgramEnabled: isFundedProgramEnabled(),
        payoutsEnabled: arePayoutsEnabled(),
        // Spread last: it also carries `liveTradingEnabled`, which is sourced
        // from the same hard-off function either way.
        ...unifiedTradingFlagSnapshot(),
    } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Trading Service capability flags
//
// `LIVE_TRADING_ENABLED` is NOT a flag: live execution is not reachable in
// this phase. `liveExecutionEnabled()` returns false unconditionally and no
// environment variable can change it. The only environment the service will
// execute against is DEMO, enforced in `UnifiedTradingService`.
// ─────────────────────────────────────────────────────────────────────────────

/** DEMO is the only executable mode. Anything else is treated as disabled. */
export const TRADING_EXECUTION_MODE = "DEMO" as const;

export function isUnifiedTradingEnabled(): boolean {
    return envFlag(TRADING_FLAG_ENV.unifiedTrading, true);
}

export function isMt5DemoEnabled(): boolean {
    return isUnifiedTradingEnabled() && envFlag(TRADING_FLAG_ENV.mt5Demo, true);
}

/** MT4 / cTrader contracts exist; the connectors are NOT IMPLEMENTED. */
export function isMt4DemoEnabled(): boolean {
    return false;
}

export function isCTraderDemoEnabled(): boolean {
    return false;
}

/** TradingView is an interaction channel, never the execution core. */
export function isTradingViewExecutionEnabled(): boolean {
    return false;
}

/** The future AlgoVault broker provider is architecture only. */
export function isAlgoVaultBrokerEnabled(): boolean {
    return false;
}

/** Always false. Not configurable, by design. */
export function liveExecutionEnabled(): boolean {
    return false;
}

/** True when the deployment is configured for demo-only execution. */
export function isDemoExecutionMode(): boolean {
    const raw = process.env[TRADING_FLAG_ENV.executionMode]?.trim().toUpperCase();
    // Absent configuration is safe: DEMO_ONLY is the fail-closed default.
    return !raw || raw === "DEMO" || raw === "DEMO_ONLY";
}

export function unifiedTradingFlagSnapshot() {
    // Reports the EFFECTIVE mode, not an optimistic constant: a deployment
    // misconfigured with TRADING_EXECUTION_MODE=LIVE shows that here and the
    // service refuses to execute anything.
    const raw = process.env[TRADING_FLAG_ENV.executionMode]?.trim().toUpperCase();
    const demoOnly = isDemoExecutionMode();
    return {
        unifiedTradingEnabled: isUnifiedTradingEnabled(),
        mt5DemoEnabled: isMt5DemoEnabled(),
        mt4DemoEnabled: isMt4DemoEnabled(),
        cTraderDemoEnabled: isCTraderDemoEnabled(),
        tradingViewExecutionEnabled: isTradingViewExecutionEnabled(),
        algoVaultBrokerEnabled: isAlgoVaultBrokerEnabled(),
        liveTradingEnabled: liveExecutionEnabled(),
        executionMode: demoOnly ? TRADING_EXECUTION_MODE : raw ?? TRADING_EXECUTION_MODE,
        demoExecutionMode: demoOnly,
    } as const;
}
