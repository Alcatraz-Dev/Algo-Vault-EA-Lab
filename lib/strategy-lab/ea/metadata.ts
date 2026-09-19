// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — metadata / hashing / magic number.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";

export function generateMagicNumber(strategyId: string, symbol: string, version: string): number {
    const hash = crypto.createHash("sha256").update(`${strategyId}:${symbol}:${version}`).digest("hex");
    const num = parseInt(hash.slice(0, 8), 16);
    // MT5 magic numbers are positive 64-bit integers; keep in a safe range.
    return 100000 + (num % 900000);
}

export function generateStrategyHash(strategy: Record<string, unknown>): string {
    const stable = JSON.stringify(strategy, Object.keys(strategy).sort());
    return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export function buildEAMetadataComment(name: string, strategyId: string, version: string, magicNumber: number, generatedAt: number): string {
    return `AlgoVault EA: ${name} | StrategyId: ${strategyId} | Version: ${version} | Magic: ${magicNumber} | Generated: ${generatedAt}`;
}
