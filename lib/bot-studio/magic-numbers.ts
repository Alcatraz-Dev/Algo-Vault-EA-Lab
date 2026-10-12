/**
 * Bot Studio — Magic Number registry.
 *
 * Each strategy deployed to MT5 must carry a stable, unique Magic Number so
 * that positions opened by that bot can be identified and isolated from:
 *   • manual trades
 *   • positions from other bots / EAs
 *
 * Requirements:
 *   1. Deterministic: same strategyId → same magic number across restarts.
 *   2. Unique within the platform's range.
 *   3. Stable: a deployed strategy's magic number never changes (changing it
 *      would orphan open positions on the MT5 side).
 *   4. Range: MT5 magic numbers are 32-bit signed integers; we use
 *      100_000_000–199_999_999 for bot-studio strategies (100M range).
 *
 * WARNING: Once a strategy is deployed, its magic number is immutable. Never
 * call `assignMagicNumber` to change an already-deployed strategy's number.
 */

import crypto from "crypto";

/** MT5 magic number range reserved for Bot Studio strategies. */
const MAGIC_MIN = 100_000_000;
const MAGIC_MAX = 199_999_999;
const MAGIC_RANGE = MAGIC_MAX - MAGIC_MIN + 1;

/**
 * Derive a deterministic magic number from a strategy ID.
 *
 * Uses SHA-256 of the strategy ID, takes the first 4 bytes as an unsigned
 * 32-bit integer, then maps it into the reserved range.
 *
 * Collision probability within the range (~100M) with <1000 strategies is
 * negligible (birthday problem: ~(1000^2 / 2) / 100M ≈ 0.5%).
 *
 * For production deployments, persist the assigned number in the strategy
 * record and never re-derive it (in case the algorithm changes). This function
 * is deterministic so initial assignment is always safe to call.
 */
export function deriveMagicNumber(strategyId: string): number {
    const hash = crypto.createHash("sha256").update(strategyId, "utf8").digest();
    // First 4 bytes as unsigned 32-bit big-endian integer.
    const raw = hash.readUInt32BE(0);
    return MAGIC_MIN + (raw % MAGIC_RANGE);
}

/**
 * Verify that a magic number falls within the Bot Studio range.
 * Numbers outside this range are not bot-studio-owned.
 */
export function isBotStudioMagicNumber(magic: number): boolean {
    return Number.isInteger(magic) && magic >= MAGIC_MIN && magic <= MAGIC_MAX;
}

/**
 * Check whether a strategy owns a given MT5 position.
 *
 * Rules:
 *   1. The position's magic number must match the strategy's magic number.
 *   2. The position's symbol must match the strategy's symbol.
 *
 * If either check fails, the position is NOT attributed to this strategy
 * and must not be closed or modified by its runtime.
 */
export function strategyOwnsPosition(
    strategyMagic: number,
    strategySymbol: string,
    positionMagic: number,
    positionSymbol: string,
): boolean {
    if (!isBotStudioMagicNumber(strategyMagic)) return false;
    if (strategyMagic !== positionMagic) return false;
    // Normalise: strip spaces, uppercase.
    const sym = (s: string) => s.replace(/\s/g, "").toUpperCase();
    return sym(strategySymbol) === sym(positionSymbol);
}

/**
 * Build the comment string that the gateway stamps on MT5 orders.
 * Format: `AV_STUDIO_{strategyId}` — truncated to 31 chars (MT5 limit).
 */
export function buildOrderComment(strategyId: string): string {
    const raw = `AV_STUDIO_${strategyId}`;
    return raw.slice(0, 31);
}
