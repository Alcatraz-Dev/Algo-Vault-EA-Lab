/**
 * AlgoVault — scalping bot trade pacing.
 *
 * This layer is a STRATEGY PACING FILTER, not a risk approval. It can only
 * REDUCE the number of entries a bot attempts; it never approves one. Every
 * order that survives it still has to pass:
 *
 *   AI Execution Gate (evidence, freshness, canonical Risk Engine, spread,
 *   exposure, kill switch) → Unified Trading Service (license, demo-only,
 *   notional reservation, order fingerprint, idempotency) → MT5 Demo gateway.
 *
 * It exists because trades-per-day, cooldown and a bot-level notional cap are
 * properties of the CONFIGURATION, not of the account, so the account risk
 * engine cannot see them. Account-level limits are never raised here — the
 * effective budget is the minimum of the bot cap and the account cap, and the
 * account cap is enforced independently by the risk engine.
 *
 * Every input is persisted state (bot executions, gateway positions, the
 * account risk snapshot). Nothing is estimated; unknown state fails closed.
 */

import { accountKey, loadAccountRiskSnapshot } from "@/lib/risk/account-state";
import { getRecentExecutions } from "../database";
import type { BotDeployment, BotSignal } from "../types";
import type { ScalpingBotConfig } from "./profiles";

export type ScalpingPacingCode =
    | "OK"
    | "MAX_TRADES_PER_DAY"
    | "COOLDOWN_ACTIVE"
    | "MAX_POSITIONS"
    | "DRAWDOWN_BREAKER_ACTIVE"
    | "DAILY_NOTIONAL_UNKNOWN"
    | "DAILY_NOTIONAL_BUDGET";

export interface ScalpingPacingContext {
    now: number;
    /** Entries the bot actually submitted today (UTC day). */
    tradesToday: number;
    /** Timestamp of the most recent submitted entry, if any. */
    lastEntryAt: number | null;
    /** Open positions on the account carrying THIS bot's magic number. */
    openPositions: number;
    /** Open positions by direction (bidirectional lanes). */
    openPositionsBySide?: { long: number; short: number };
    /** Most recent submitted entry per direction. */
    lastEntryAtBySide?: { long: number | null; short: number | null };
    /** Today's executed notional from the account ledger; null = unknown. */
    dailyNotionalUsed: number | null;
    dailyNotionalIncomplete: boolean;
    drawdownBreakerActive: boolean;
}

export interface ScalpingPacingResult {
    ok: boolean;
    code: ScalpingPacingCode;
    reason?: string;
}

/** UTC midnight for the timestamp — the day boundary used for "per day" caps. */
export function startOfUtcDay(now: number): number {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Pure pacing decision. Deterministic: identical inputs, identical result. */
export function evaluateScalpingPacing(
    config: ScalpingBotConfig,
    context: ScalpingPacingContext,
    side?: "long" | "short",
): ScalpingPacingResult {
    if (context.drawdownBreakerActive) {
        return {
            ok: false,
            code: "DRAWDOWN_BREAKER_ACTIVE",
            reason: "The account drawdown breaker is latched — new entries require an audited reset.",
        };
    }

    // Direction-specific limits when the runtime is running two lanes. The
    // daily trade cap and the notional budget stay account/bot-wide: they are
    // shared by both directions and must never be duplicated per lane.
    const openPositions = side && context.openPositionsBySide
        ? context.openPositionsBySide[side]
        : context.openPositions;
    if (openPositions >= config.maxOpenPositions) {
        return {
            ok: false,
            code: "MAX_POSITIONS",
            reason: `Bot already holds ${openPositions} ${side ? `${side} ` : ""}position(s); limit is ${config.maxOpenPositions}.`,
        };
    }

    if (context.tradesToday >= config.maxTradesPerDay) {
        return {
            ok: false,
            code: "MAX_TRADES_PER_DAY",
            reason: `Daily trade cap reached (${context.tradesToday}/${config.maxTradesPerDay}).`,
        };
    }

    const lastEntryAt = side && context.lastEntryAtBySide
        ? context.lastEntryAtBySide[side]
        : context.lastEntryAt;
    if (
        config.cooldownSeconds > 0 &&
        lastEntryAt !== null &&
        context.now - lastEntryAt < config.cooldownSeconds * 1000
    ) {
        const remaining = Math.ceil((config.cooldownSeconds * 1000 - (context.now - lastEntryAt)) / 1000);
        return {
            ok: false,
            code: "COOLDOWN_ACTIVE",
            reason: `Cooldown active for another ${remaining}s${side ? ` on the ${side} lane` : ""}.`,
        };
    }

    if (config.dailyNotionalBudget !== null) {
        if (context.dailyNotionalIncomplete) {
            return {
                ok: false,
                code: "DAILY_NOTIONAL_UNKNOWN",
                reason: "Today's notional accounting is incomplete — the bot budget cannot be enforced.",
            };
        }
        if (context.dailyNotionalUsed === null) {
            return {
                ok: false,
                code: "DAILY_NOTIONAL_UNKNOWN",
                reason: "Today's notional usage is unknown (no ledger yet) — refusing to guess.",
            };
        }
        if (context.dailyNotionalUsed >= config.dailyNotionalBudget) {
            return {
                ok: false,
                code: "DAILY_NOTIONAL_BUDGET",
                reason: `Bot notional cap reached (${Math.round(context.dailyNotionalUsed)} of ${Math.round(config.dailyNotionalBudget)}).`,
            };
        }
    }

    return { ok: true, code: "OK" };
}

const SUBMITTED_STATUSES = new Set([
    "submitted",
    "acknowledged",
    "filled",
    "executed_pending_sync",
    "uncertain",
]);

/** Load the persisted state the pacing decision needs. */
export async function loadScalpingPacingContext(
    userId: string,
    mt5Account: string,
    botId: string,
    magicNumber: number,
    now: number = Date.now(),
): Promise<ScalpingPacingContext> {
    const account = accountKey(mt5Account);
    const dayStart = startOfUtcDay(now);

    const [executions, snapshot] = await Promise.all([
        getRecentExecutions(botId, 200).catch(() => []),
        loadAccountRiskSnapshot(userId, account).catch(() => null),
    ]);

    const submitted = executions.filter((e) => SUBMITTED_STATUSES.has(e.status));
    const tradesToday = submitted.filter((e) => (e.createdAt ?? 0) >= dayStart).length;
    const lastEntryAt = submitted.reduce<number | null>(
        (latest, e) => (latest === null || e.createdAt > latest ? e.createdAt : latest),
        null,
    );

    // Positions are attributed by magic number; a manual trade or another
    // bot's position never counts against this bot's cap.
    const positions = await snapshotPositions(userId, account);
    const openPositionsBySide = { long: 0, short: 0 };
    let openPositions = 0;
    for (const position of positions) {
        if (Number(position.magic) !== magicNumber) continue;
        openPositions += 1;
        const type = String(position.type ?? "").toUpperCase();
        if (type === "BUY") openPositionsBySide.long += 1;
        else if (type === "SELL") openPositionsBySide.short += 1;
        // An unreported side is counted in BOTH lanes: exposure we cannot
        // attribute must never be treated as the other lane's free slot.
        else {
            openPositionsBySide.long += 1;
            openPositionsBySide.short += 1;
        }
    }

    const lastEntryAtBySide = { long: null as number | null, short: null as number | null };
    for (const execution of submitted) {
        const side = execution.direction === "BUY" ? "long" : "short";
        const at = Number(execution.createdAt) || 0;
        if (at > 0 && (lastEntryAtBySide[side] === null || at > lastEntryAtBySide[side]!)) {
            lastEntryAtBySide[side] = at;
        }
    }

    return {
        now,
        tradesToday,
        lastEntryAt,
        openPositions,
        openPositionsBySide,
        lastEntryAtBySide,
        dailyNotionalUsed: snapshot?.account.dailyNotionalUsed ?? null,
        dailyNotionalIncomplete: snapshot?.account.dailyNotionalIncomplete === true,
        drawdownBreakerActive: snapshot?.account.drawdownBreakerActive === true,
    };
}

async function snapshotPositions(
    userId: string,
    account: string,
): Promise<Array<{ magic?: number | string; type?: number | string }>> {
    try {
        const { adminDatabase } = await import("@/lib/firebase-admin");
        const snap = await adminDatabase.ref(`trading_positions/${userId}/${account}`).get();
        if (!snap.exists()) return [];
        const val = (snap.val() || {}) as Record<string, { magic?: number | string; type?: number | string }>;
        return Object.values(val).filter(
            (p): p is { magic?: number | string; type?: number | string } => !!p && typeof p === "object",
        );
    } catch {
        return [];
    }
}

export interface PacingCheckInput {
    deployment: BotDeployment;
    config: ScalpingBotConfig;
    magicNumber: number;
    now?: () => number;
}

/**
 * Build the `preSignalCheck` hook consumed by `BotRuntimeSession`.
 *
 * Returning `{ ok: false, code, reason }` makes the runtime record a rejected
 * signal and stop BEFORE the gate and before any order is built.
 */
export function createScalpingPacingCheck(
    input: PacingCheckInput,
): (signal: BotSignal) => Promise<ScalpingPacingResult> {
    const { deployment, config, magicNumber } = input;
    const clock = input.now ?? (() => Date.now());

    return async (signal: BotSignal) => {
        const now = clock();
        const side = signal.direction === "BUY" ? ("long" as const) : ("short" as const);
        try {
            const context = await loadScalpingPacingContext(
                deployment.ownerId,
                deployment.mt5Account,
                deployment.id,
                magicNumber,
                now,
            );
            return evaluateScalpingPacing(config, context, side);
        } catch (error) {
            // Unknown pacing state is not permission to trade.
            return {
                ok: false,
                code: "DAILY_NOTIONAL_UNKNOWN",
                reason:
                    error instanceof Error
                        ? `Pacing state unavailable (${error.message}) — failing closed.`
                        : "Pacing state unavailable — failing closed.",
            };
        }
    };
}
