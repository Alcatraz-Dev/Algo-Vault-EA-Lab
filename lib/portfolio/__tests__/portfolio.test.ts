/**
 * AlgoVault — Portfolio Intelligence test fixtures + harness.
 *
 * Deterministic fixtures only. Nothing here fabricates market data at test
 * time: the price series below are synthetic but explicitly labelled as such,
 * and the engines under test only ever see the arrays handed to them.
 */

import type {
    DataFreshness,
    PortfolioAccount,
    PortfolioPosition,
    PortfolioStrategyIntelligence,
} from "../types";

let failures = 0;
let checks = 0;

export function section(title: string): void {
    process.stdout.write(`\n  ${title}\n`);
}

export function check(label: string, condition: boolean, detail?: unknown): void {
    checks += 1;
    if (condition) {
        process.stdout.write(`    ✓ ${label}\n`);
    } else {
        failures += 1;
        process.stdout.write(`    ✗ ${label}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}\n`);
    }
}

export function near(actual: number | null | undefined, expected: number, tolerance = 1e-6): boolean {
    return typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
}

export function results(): { ok: boolean; failures: number; checks: number } {
    process.stdout.write(`\n  ${checks - failures}/${checks} checks passed\n`);
    return { ok: failures === 0, failures, checks };
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

export const TEST_NOW = 1_760_000_000_000;

export function freshness(overrides: Partial<DataFreshness> = {}): DataFreshness {
    return {
        dataTimestamp: TEST_NOW - 5_000,
        calculatedAt: TEST_NOW,
        dataAgeMs: 5_000,
        freshness: "FRESH",
        sources: [{ source: "test", ageMs: 5_000 }],
        ...overrides,
    };
}

export function account(overrides: Partial<PortfolioAccount> = {}): PortfolioAccount {
    return {
        accountId: "gateway_test",
        portfolioId: "primary",
        userId: "user_test",
        kind: "LIVE",
        broker: "TestBroker",
        server: "TestServer",
        currency: "USD",
        balance: 100_000,
        equity: 100_000,
        marginUsed: 5_000,
        freeMargin: 95_000,
        leverage: 100,
        unrealizedPnL: 0,
        drawdownPercent: 0,
        dataTimestamp: TEST_NOW - 5_000,
        connected: true,
        status: "ACTIVE",
        ...overrides,
    };
}

export function position(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
    const currentPrice = overrides.currentPrice ?? 2_000;
    const quantity = overrides.quantity ?? 0.5;
    const symbol = overrides.symbol ?? "XAUUSD";
    // XAUUSD contract size is 100 in the canonical registry.
    const notional = overrides.notional ?? currentPrice * quantity * 100;
    return {
        positionId: overrides.positionId ?? "gateway_test:1",
        accountId: "gateway_test",
        symbol,
        side: "LONG",
        quantity,
        entryPrice: currentPrice,
        currentPrice,
        stopLoss: currentPrice * 0.98,
        takeProfit: null,
        riskAmount: currentPrice * 0.02 * quantity * 100,
        unrealizedPnL: 0,
        marginUsed: notional / 100,
        notional,
        equityWeight: 0.01,
        assetClass: "METALS",
        strategyId: "MANUAL",
        accountCurrency: "USD",
        currencyExposures: [],
        openedAt: TEST_NOW - 3_600_000,
        dataTimestamp: TEST_NOW - 5_000,
        ...overrides,
    };
}

/**
 * Synthetic price series. Clearly labelled: these are generated for the test,
 * not market history. `seed` controls the deterministic generator.
 */
export function syntheticSeries(seed: number, length = 300, drift = 0): { timestamps: number[]; closes: number[] } {
    const timestamps: number[] = [];
    const closes: number[] = [];
    let price = 2_000;
    let s = Math.abs(seed) || 1;
    for (let i = 0; i < length; i += 1) {
        s = (s * 16807) % 2147483647;
        const shock = (s / 2147483647 - 0.5) * 0.01;
        price = Math.max(1, price * (1 + shock + drift));
        timestamps.push(TEST_NOW - (length - i) * 3_600_000);
        closes.push(Number(price.toFixed(6)));
    }
    return { timestamps, closes };
}

/** Perfectly correlated series: `follows` scaled onto `base`'s returns. */
export function correlatedSeries(
    base: { timestamps: number[]; closes: number[] },
    scale = 1,
    offset = 0
): { timestamps: number[]; closes: number[] } {
    const returns: number[] = [];
    for (let i = 1; i < base.closes.length; i += 1) {
        returns.push(base.closes[i] / base.closes[i - 1]);
    }
    const closes: number[] = [base.closes[0] * scale + offset];
    for (let i = 1; i < base.closes.length; i += 1) {
        closes.push(closes[i - 1] * returns[i - 1]);
    }
    return { timestamps: [...base.timestamps], closes };
}

export function emptyStrategyIntelligence(portfolioId = "primary"): PortfolioStrategyIntelligence {
    return {
        portfolioId,
        calculatedAt: TEST_NOW,
        strategies: [],
        overlaps: [],
        hiddenConcentrationDetected: false,
        limitations: [],
    };
}

export { TEST_NOW as NOW };
