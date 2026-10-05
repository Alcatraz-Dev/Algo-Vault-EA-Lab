/**
 * GET /api/terminal/risk — the terminal's Risk HUD data source (Phase 5 §20).
 *
 * Thin wrapper over the CANONICAL risk engine (`lib/risk`). It does no
 * arithmetic of its own beyond mapping an engine verdict onto the four HUD
 * states:
 *
 *   EMERGENCY_STOP | DAILY_LOSS_LIMIT | MAX_DRAWDOWN      → HALTED
 *   MAX_OPEN_POSITIONS | SYMBOL_EXPOSURE_LIMIT | COOLDOWN |
 *   NO_RISK_FUNDS | MARKET_ENTRY_DISABLED                → RESTRICTED
 *   APPROVED within 80% of a configured daily-loss or
 *   drawdown limit                                        → WARNING
 *   otherwise                                             → SAFE
 *
 * Everything numeric is read from the live account record. A field the
 * platform does not record comes back as `null`, never as 0.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadAccountRiskSnapshot, buildEntryRiskLimits } from "@/lib/risk/account-state";
import { evaluateOrder, type RiskDecision, type RiskLimits } from "@/lib/risk/risk-engine";
import { adminDatabase } from "@/lib/firebase-admin";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HudRiskStatus = "SAFE" | "WARNING" | "RESTRICTED" | "HALTED";

const HALTED_CODES = new Set(["EMERGENCY_STOP", "DAILY_LOSS_LIMIT", "MAX_DRAWDOWN"]);
const RESTRICTED_CODES = new Set([
    "MAX_OPEN_POSITIONS",
    "SYMBOL_EXPOSURE_LIMIT",
    "COOLDOWN_ACTIVE",
    "NO_RISK_FUNDS",
    "MARKET_ENTRY_DISABLED",
]);

/** Fraction of a configured limit that flips SAFE → WARNING. */
const WARNING_RATIO = 0.8;

function num(v: unknown): number | null {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function statusFrom(
    decision: RiskDecision,
    limits: RiskLimits,
    dailyLossPercent: number | null,
    drawdownPercent: number | null
): { status: HudRiskStatus; reasons: string[] } {
    const reasons: string[] = [];

    if (HALTED_CODES.has(decision.code)) {
        reasons.push(decision.reason ?? decision.code);
        return { status: "HALTED", reasons };
    }
    if (RESTRICTED_CODES.has(decision.code)) {
        reasons.push(decision.reason ?? decision.code);
        return { status: "RESTRICTED", reasons };
    }

    const near = (value: number | null, limit: number | undefined, label: string): boolean => {
        if (value === null || typeof limit !== "number" || !(limit > 0)) return false;
        if (value >= limit) {
            reasons.push(`${label} at limit (${value.toFixed(2)}% / ${limit}%)`);
            return true;
        }
        if (value >= limit * WARNING_RATIO) {
            reasons.push(`${label} ${value.toFixed(2)}% of ${limit}% limit`);
            return true;
        }
        return false;
    };

    const daily = near(dailyLossPercent, limits.maxDailyLossPercent, "Daily loss");
    const dd = near(drawdownPercent, limits.maxDrawdownPercent, "Drawdown");
    if (daily || dd) return { status: "WARNING", reasons };

    return { status: "SAFE", reasons };
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const params = request.nextUrl.searchParams;
        const symbolParam = (params.get("symbol") || "").toUpperCase();
        const symbol: SupportedSymbol = (SUPPORTED_SYMBOLS as readonly string[]).includes(symbolParam)
            ? (symbolParam as SupportedSymbol)
            : "XAUUSD";

        // One account: the terminal follows the same record the trading page
        // and the gateway use. No account ⇒ no risk state, reported as null.
        const accountsSnap = await adminDatabase.ref(`trading_accounts/${user.uid}`).get();
        const accounts = accountsSnap.exists() ? (accountsSnap.val() as Record<string, unknown>) : {};
        const accountId = Object.keys(accounts)[0];

        if (!accountId) {
            return NextResponse.json(
                { status: null, reasons: ["No connected trading account."], limits: null, metrics: null, accountId: null },
                { status: 200 }
            );
        }

        const snapshot = await loadAccountRiskSnapshot(user.uid, accountId, symbol);
        const limits = buildEntryRiskLimits(snapshot);
        const record = snapshot.accountRecord;

        const balance = num(record.balance);
        const equity = num(record.equity);
        const usedMargin = num(record.margin);
        const availableMargin = num(record.freeMargin);

        // The canonical engine is asked the exact question the HUD answers:
        // "may a normal entry be opened on this symbol right now?"
        const decision = evaluateOrder(
            {
                symbol,
                direction: "BUY",
                entryKind: "MARKET",
                price: 0,
                // Probe volume: broker step-clamped default. Only the verdict is
                // used — nothing is placed and no volume is echoed as a size.
                volume: limits.defaultLot ?? limits.minLot ?? 0.01,
            },
            limits,
            snapshot.account
        );

        const dailyLossPercent = snapshot.account.dailyLossPercent ?? null;
        const drawdownPercent = snapshot.account.drawdownPercent ?? null;
        const { status, reasons } = statusFrom(decision, limits, dailyLossPercent, drawdownPercent);

        const openPositions = snapshot.account.openPositionsCount ?? null;
        const exposureLots = snapshot.account.symbolExposureLots ?? null;

        return NextResponse.json(
            {
                status,
                reasons: reasons.length ? reasons : decision.reason ? [decision.reason] : [],
                decision: { approved: decision.approved, code: decision.code, reason: decision.reason ?? null },
                limits: {
                    emergencyStop: limits.emergencyStop === true,
                    maxDailyLossPercent: limits.maxDailyLossPercent ?? null,
                    maxDrawdownPercent: limits.maxDrawdownPercent ?? null,
                    maxOpenPositions: limits.maxOpenPositions ?? null,
                    requireStopLoss: limits.requireStopLoss === true,
                    riskPercent: limits.riskPercent ?? null,
                },
                metrics: {
                    balance,
                    equity,
                    usedMargin,
                    availableMargin,
                    floatingPnL: balance !== null && equity !== null ? equity - balance : null,
                    drawdownPct: drawdownPercent,
                    dailyLossPct: dailyLossPercent,
                    openPositions,
                    symbolExposureLots: exposureLots,
                    halted: snapshot.emergencyStop,
                },
                accountId,
                symbol,
                fetchedAt: Date.now(),
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[GET /api/terminal/risk]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Risk state unavailable" }, { status: 500 });
    }
}
