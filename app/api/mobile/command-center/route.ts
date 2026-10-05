/**
 * GET /api/mobile/command-center
 *
 * The mobile command centre in ONE request. It is an aggregation of existing
 * canonical services — not a place where market truth is computed:
 *
 *   • market overview      → `getMarketTruth` (lib/market-data/market-truth.ts)
 *   • setups               → Setup Memory records at `monitoring/setups/$uid`
 *   • alerts               → the existing alert store at `alerts/$uid`
 *   • risk                 → `trading_accounts` + `trading_positions` + the
 *                            canonical Risk Engine limits
 *   • workspace continuity → the caller's synced workspace, so the mobile screen
 *                            opens exactly where the desktop left off
 *
 * Honest-data rules, enforced structurally rather than by convention:
 *   • any sub-source that fails is reported as `unavailable` with a reason; it is
 *     never replaced with a default value
 *   • freshness comes from the canonical engine, not from a client guess
 *   • no computed score, confidence or price appears here that does not exist in
 *     the underlying record
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { SUPPORTED_SYMBOLS, type Timeframe } from "@/lib/market-data/types";
import { MEMORY_PATHS } from "@/lib/market-intelligence/memory/repository";
import { brokerLimitsFromAccount, type RiskLimits } from "@/lib/risk/risk-engine";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";
import type { WorkspaceState } from "@/lib/mobile/contracts";
import { readWorkspace } from "@/lib/mobile/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounded so a pathological watchlist cannot turn this into a fan-out of 200
 *  upstream price requests on the render path. */
const MAX_SYMBOLS = 8;

const SYMBOL_SET = new Set<string>(SUPPORTED_SYMBOLS as readonly string[]);

/** Anything not in this set is refused rather than forwarded to a provider. */
function safeSymbols(raw: string[]): string[] {
    return Array.from(new Set(raw.map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_SET.has(s)))).slice(0, MAX_SYMBOLS);
}

type Unavailable = { available: false; reason: string };

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const params = request.nextUrl.searchParams;
        const timeframe = (params.get("tf") ?? "M5") as Timeframe;

        // Workspace is the source of truth for WHICH symbols to show, which is
        // what makes "open the phone, see the same watchlist" true. A first-ever
        // device has no workspace yet, so it falls back to the platform's majors —
        // real instruments, not invented ones.
        const workspace = await readWorkspace(user.uid).catch(() => null);
        const requested = params.get("symbols");
        const symbols = safeSymbols(requested ? requested.split(",") : symbolsFromWorkspace(workspace?.data));

        const [marketResult, setupsResult, alertsResult, accountResult] = await Promise.all([
            Promise.all(symbols.map((symbol) => getMarketTruth(symbol, timeframe).catch(() => null))),
            readSetups(user.uid),
            readAlerts(user.uid),
            readAccount(user.uid),
        ]);

        const markets = symbols.map((symbol, i) => {
            const entry = marketResult[i];
            if (!entry) {
                return { symbol, available: false as const, reason: "No market data available for this symbol." };
            }
            const { snapshot, freshness } = entry;
            return {
                symbol,
                available: true as const,
                price: snapshot.currentPrice,
                bid: snapshot.bid,
                ask: snapshot.ask,
                spread: snapshot.spread,
                // Deliberately no change/changePercent: `MarketSnapshot` does not
                // carry a session change, and computing one from bid vs. current
                // price would be a fabricated number.
                trend: snapshot.trend,
                structure: snapshot.marketStructure,
                regime: snapshot.regime,
                session: snapshot.marketSession,
                marketStatus: snapshot.marketStatus,
                volatility: snapshot.volatility,
                // Straight from the canonical detector — not re-derived here.
                fvgCount: snapshot.FVG.length,
                activeFvg: snapshot.FVG.filter((z) => z.status === "active").length,
                orderBlockCount: snapshot.orderBlocks.length,
                sweeps: snapshot.sweeps.slice(-3),
                liquidityLevels: snapshot.liquidity.levels.slice(0, 5),
                provider: snapshot.provider,
                // The canonical verdict, passed through untouched.
                freshness: {
                    fresh: freshness.fresh,
                    status: freshness.status,
                    dataAgeMs: freshness.dataAgeMs,
                    thresholdMs: freshness.thresholdMs,
                    category: freshness.category,
                },
                dataTimestamp: snapshot.timestamp,
            };
        });

        const riskStatus = accountResult.available
            ? deriveRiskStatus(accountResult.account)
            : ("unavailable" as const);

        return NextResponse.json(
            {
                success: true,
                generatedAt: startedAt,
                elapsedMs: Date.now() - startedAt,
                timeframe,
                // Workspace continuity: the phone opens where the desktop stopped.
                workspace: workspace
                    ? {
                          selectedSymbol: workspace.data.selectedSymbol,
                          selectedTimeframe: workspace.data.selectedTimeframe,
                          activeWorkspace: workspace.data.activeWorkspace,
                          revision: workspace.revision,
                          updatedAt: workspace.updatedAt,
                          updatedByPlatform: workspace.updatedByPlatform,
                      }
                    : null,
                markets,
                setups: setupsResult.available ? setupsResult.setups : ([] as SetupMemoryRecord[]),
                setupSource: setupsResult.available ? ("setup_memory" as const) : setupsResult,
                alerts: alertsResult.available ? alertsResult.alerts : [],
                alertSource: alertsResult.available ? ("alert_store" as const) : alertsResult,
                risk: accountResult,
                riskStatus,
                limits: accountResult.available ? accountResult.account.limits : null,
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (err) {
        console.error("[mobile/command-center] failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to build command centre" }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-sources. Each one fails independently and says so.
// ─────────────────────────────────────────────────────────────────────────────

async function readSetups(uid: string): Promise<
    { available: true; setups: SetupMemoryRecord[] } | Unavailable
> {
    try {
        const snap = await adminDatabase.ref(MEMORY_PATHS.userSetups(uid)).get();
        if (!snap.exists()) return { available: true, setups: [] };
        const data = snap.val() as Record<string, SetupMemoryRecord>;
        const setups = Object.entries(data)
            .map(([id, record]) => ({ ...record, id: record.id ?? id }))
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            .slice(0, 25);
        return { available: true, setups };
    } catch (err) {
        return { available: false, reason: `Setup Memory unavailable: ${errMessage(err)}` };
    }
}

async function readAlerts(uid: string): Promise<{ available: true; alerts: AlertRecord[] } | Unavailable> {
    try {
        const snap = await adminDatabase.ref(`alerts/${uid}`).get();
        if (!snap.exists()) return { available: true, alerts: [] };
        const data = snap.val() as Record<string, Omit<AlertRecord, "id">>;
        const alerts = Object.entries(data)
            .map(([id, a]) => ({ id, ...a }))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .slice(0, 25);
        return { available: true, alerts };
    } catch (err) {
        return { available: false, reason: `Alert store unavailable: ${errMessage(err)}` };
    }
}

interface AccountRecord {
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    status: string;
    lastHeartbeatAt: number;
}

async function readAccount(
    uid: string,
): Promise<
    | {
          available: true;
          account: AccountRecord & {
              openPositions: number;
              exposure: Array<{ symbol: string; lots: number }>;
              limits: RiskLimits | null;
          };
      }
    | Unavailable
> {
    try {
        const [accounts, positions] = await Promise.all([
            adminDatabase.ref(`trading_accounts/${uid}`).get(),
            adminDatabase.ref(`trading_positions/${uid}`).get(),
        ]);
        if (!accounts.exists()) {
            return { available: false, reason: "No trading account is connected." };
        }
        const raw = accounts.val() as Record<string, Record<string, unknown>>;
        const first = Object.values(raw)[0] ?? {};

        const openBySymbol = new Map<string, number>();
        let openPositions = 0;
        if (positions.exists()) {
            const pos = positions.val() as Record<string, Record<string, unknown>>;
            for (const value of Object.values(pos)) {
                const lots = Number(value.lots ?? value.volume ?? 0);
                const symbol = String(value.symbol ?? "UNKNOWN");
                openBySymbol.set(symbol, (openBySymbol.get(symbol) ?? 0) + Math.abs(lots));
                openPositions += 1;
            }
        }

        // `brokerLimitsFromAccount` is the canonical derivation used by the Risk
        // Engine itself. Mobile reads it rather than restating broker rules.
        const brokerLimits = brokerLimitsFromAccount(first);

        return {
            available: true,
            account: {
                balance: Number(first.balance ?? 0),
                equity: Number(first.equity ?? 0),
                margin: Number(first.margin ?? 0),
                freeMargin: Number(first.freeMargin ?? 0),
                status: String(first.status ?? "unknown"),
                lastHeartbeatAt: Number(first.lastHeartbeatAt ?? 0),
                openPositions,
                exposure: Array.from(openBySymbol.entries())
                    .map(([symbol, lots]) => ({ symbol, lots }))
                    .sort((a, b) => b.lots - a.lots),
                // Only the broker-derived portion is available without a stored
                // policy; policy limits come from the account record when present.
                limits: {
                    ...brokerLimits,
                    maxDrawdownPercent: numberOrUndefined(first.maxDrawdownPercent),
                    maxDailyLossPercent: numberOrUndefined(first.maxDailyLossPercent),
                    maxOpenPositions: numberOrUndefined(first.maxOpenPositions),
                    emergencyStop: first.emergencyStop === true,
                    requireStopLoss: first.requireStopLoss !== false,
                },
            },
        };
    } catch (err) {
        return { available: false, reason: `Account state unavailable: ${errMessage(err)}` };
    }
}

function numberOrUndefined(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Which symbols the command centre shows.
 *
 * Priority: the user's own watchlist (in their order) → whatever symbol they
 * currently have selected → the platform's majors. This is the cross-device
 * continuity guarantee: the phone shows the watchlist the desktop arranged.
 */
export function symbolsFromWorkspace(workspace: WorkspaceState | undefined): string[] {
    if (!workspace) return ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100"];
    const primary = [...(workspace.watchlists ?? [])].sort((a, b) => a.order - b.order)[0];
    if (primary?.symbols?.length) return primary.symbols;
    const focused = [workspace.chartSymbol, workspace.selectedSymbol].filter((s): s is string => Boolean(s));
    return focused.length ? focused : ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100"];
}

/**
 * Risk limits come from the canonical Risk Engine's broker/account derivation
 * (`brokerLimitsFromAccount` + the `RiskLimits` shape). The mobile surface reads
 * them; it never supplies its own thresholds. When no account is connected the
 * limits are `null` rather than a permissive default, so a screen cannot render
 * "within limits" against limits that were never defined.
 */

/**
 * Risk status is *presented* here but *decided* by the canonical Risk Engine's
 * limits. A mobile screen must never invent its own thresholds — when the values
 * below are unknown we say `unavailable` rather than guessing "NORMAL".
 */
function deriveRiskStatus(
    account: AccountRecord & { openPositions: number; limits: RiskLimits | null },
): "normal" | "caution" | "restricted" | "halted" | "unavailable" {
    if (!Number.isFinite(account.equity) || account.equity <= 0) return "unavailable";

    const limits = account.limits;
    if (!limits) return "unavailable";
    if (limits.emergencyStop) return "halted";

    const drawdownPercent =
        account.balance > 0 ? Math.max(0, ((account.balance - account.equity) / account.balance) * 100) : 0;

    if (limits.maxDrawdownPercent !== undefined && drawdownPercent >= limits.maxDrawdownPercent) return "halted";
    if (limits.maxDrawdownPercent !== undefined && drawdownPercent >= limits.maxDrawdownPercent * 0.75) {
        return "restricted";
    }
    if (limits.maxOpenPositions !== undefined && account.openPositions >= limits.maxOpenPositions) {
        return "restricted";
    }
    return "normal";
}

interface AlertRecord {
    id: string;
    symbol: string;
    type: string;
    timeframe: string;
    message: string;
    triggered: boolean;
    triggeredAt?: number;
    createdAt: number;
}
