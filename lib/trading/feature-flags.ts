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
        liveTradingEnabled: isLiveTradingEnabled(),
        fundedProgramEnabled: isFundedProgramEnabled(),
        payoutsEnabled: arePayoutsEnabled(),
    } as const;
}
