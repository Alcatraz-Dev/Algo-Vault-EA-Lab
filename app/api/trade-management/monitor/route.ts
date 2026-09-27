import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    transitionState,
    createTradeEvent,
    saveTradeState,
    queueModifySl,
    queuePartialClose,
} from "@/lib/trade-management/service";
import { sendNotification } from "@/lib/trade-management/notifications";
import {
    TradeManagementState,
    TradeState,
    TradeEventType,
} from "@/lib/trade-management/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================
// MONITOR: watch every open managed trade
// Called by cron (x-cron-secret) or heartbeat.
// For each trade:
//   1. sync live price from trading_positions
//   2. detect closed positions on MT5
//   3. check SL hit (direction-aware)
//   4. check TP hits (direction-aware) -> event + notification
//   5. when autoManagement:
//        - partial close at each TP
//        - break-even after the configured trigger TP
//        - profit lock after the configured trigger TP
//        - trailing stop on the runner
// ============================================

const TERMINAL_STATES = ["CLOSED", "STOPPED", "CANCELLED"];
const CHECK_INTERVAL_MS = 30000;

export async function POST(request: NextRequest) {
    try {
        // Fail-closed cron auth: requires x-cron-secret (or ?secret=) matching
        // CRON_SECRET, or Vercel's cron runner UA. Refuses when CRON_SECRET is unset.
        const cronSecret = process.env.CRON_SECRET;
        const headerSecret = request.headers.get("x-cron-secret") || "";
        const querySecret = new URL(request.url).searchParams.get("secret") || "";
        const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");
        if (!isVercelCron && !Boolean(cronSecret && (headerSecret === cronSecret || querySecret === cronSecret))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const { accountId, userId } = body as { accountId?: string; userId?: string };

        const snapshot = await adminDatabase.ref("tradeManagement").get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, monitored: 0, actions: 0 });
        }

        let monitored = 0;
        let actions = 0;

        const allUsers = snapshot.val() as Record<string, Record<string, Record<string, TradeManagementState>>>;

        for (const [uid, accountsRaw] of Object.entries(allUsers)) {
            if (userId && uid !== userId) continue;
            if (!accountsRaw || typeof accountsRaw !== "object") continue;

            for (const [accId, tradesRaw] of Object.entries(accountsRaw)) {
                if (accountId && accId !== accountId) continue;
                if (!tradesRaw || typeof tradesRaw !== "object") continue;

                // Load the account's live positions once per account.
                const positionsSnap = await adminDatabase.ref(`trading_positions/${uid}/${accId}`).get();
                const positions = (positionsSnap.val() || {}) as Record<string, Record<string, unknown>>;

                for (const [ticket, tradeRaw] of Object.entries(tradesRaw)) {
                    if (!tradeRaw || typeof tradeRaw !== "object") continue;
                    try {
                        const res = await processTrade(uid, accId, ticket, tradeRaw as TradeManagementState, positions);
                        if (res.monitored) monitored++;
                        if (res.actions) actions += res.actions;
                    } catch (tradeErr) {
                        console.error(`[trade-management/monitor] trade ${ticket} failed:`, tradeErr);
                    }
                }
            }
        }

        return NextResponse.json({ success: true, monitored, actions });
    } catch (err) {
        console.error("Trade monitor error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// PER-TRADE PROCESSING
// ============================================

async function processTrade(
    uid: string,
    accountId: string,
    ticket: string,
    state: TradeManagementState,
    positions: Record<string, Record<string, unknown>>
): Promise<{ monitored: boolean; actions: number }> {
    if (TERMINAL_STATES.includes(state.state)) return { monitored: false, actions: 0 };
    if (state.manualOverride) return { monitored: false, actions: 0 };
    if (Date.now() - (state.lastCheckedAt || 0) < CHECK_INTERVAL_MS) return { monitored: false, actions: 0 };

    const position = positions[ticket];

    if (!position) {
        // Position gone from MT5 -> trade is fully closed.
        await transitionState(uid, accountId, ticket, "CLOSED", "Position no longer exists on MT5");
        return { monitored: true, actions: 0 };
    }

    const currentPrice = Number(position.currentPrice || position.price || 0);
    if (!currentPrice) return { monitored: false, actions: 0 };

    const liveVolume = Number(position.volume || 0);
    const isBuy = state.direction === "BUY";

    // ---- Price & PnL sync (per-lot PnL, matching MT5 semantics) ----
    state.currentPrice = currentPrice;
    state.lastCheckedAt = Date.now();

    const priceDelta = isBuy ? currentPrice - state.entry : state.entry - currentPrice;
    state.currentPnl = priceDelta * state.volume * getContractSize(state.symbol);

    // R-multiple measured against the ORIGINAL risk (entry - initial SL),
    // so it stays comparable as the SL ratchets toward profit.
    const originalRisk = state.riskPoints > 0 ? state.riskPoints : Math.abs(state.entry - state.currentSl);
    state.currentR = originalRisk > 0 ? priceDelta / originalRisk : 0;

    // ---- Volume sync from the live position ----
    const previousVolume = state.remainingVolume;
    if (liveVolume > 0) state.remainingVolume = liveVolume;

    // Position volume dropped on MT5 but we didn't record a close ourselves:
    // the trader partially closed manually -> reconcile our ledger.
    const expectedRemaining = state.volume - closeHistoryVolume(state);
    if (liveVolume > 0 && liveVolume < previousVolume - 1e-8 && liveVolume < expectedRemaining - 1e-8) {
        const reconciledVolume = round2(previousVolume - liveVolume);
        state.closeHistory.push({
            target: "MANUAL",
            volume: reconciledVolume,
            price: currentPrice,
            timestamp: Date.now(),
        });
        await createTradeEvent(uid, accountId, ticket, "POSITION_RECONCILED", state, {
            reconciledVolume,
            liveVolume,
            previousVolume,
        });
    }

    let actions = 0;

    // ---- Trailing stop (runner) — before TP checks so an extreme move is handled ----
    const trailed = maybeTrailRunner(state, currentPrice);
    if (trailed) {
        const ok = await queueModifySl(uid, accountId, ticket, state, state.currentSl, "RUNNER_TRAILING", state.config.autoManagement ? "AUTO" : "MANUAL");
        if (ok) {
            actions++;
            await createTradeEvent(uid, accountId, ticket, "TRAILING_UPDATED", state, {
                newSl: state.currentSl,
                trailingType: state.config.trailingType,
            });
        }
    }

    // ---- STOP LOSS CHECK (direction-aware) ----
    const slReached = isBuy ? currentPrice <= state.currentSl : currentPrice >= state.currentSl;
    if (slReached && !TERMINAL_STATES.includes(state.state)) {
        // Persist synced price first so the transition event carries fresh data,
        // then run the validated transition (saves + event + audit log).
        await saveTradeState(state);
        await transitionState(uid, accountId, ticket, "STOPPED", `Stop loss hit at ${fmtPrice(currentPrice, state.symbol)}`);
        await sendNotification({
            userId: uid,
            event: "STOP_LOSS_HIT",
            title: `🛑 Stop Loss Hit — ${state.symbol} ${state.direction}`,
            message: `SL hit at ${fmtPrice(currentPrice, state.symbol)}.\nEntry: ${fmtPrice(state.entry, state.symbol)}\nPnL: ${state.currentPnl >= 0 ? "+" : ""}${state.currentPnl.toFixed(2)} USD`,
            severity: "error",
            symbol: state.symbol,
            direction: state.direction,
            channels: ["in_app", "discord", "telegram"],
        });
        return { monitored: true, actions: actions + 1 };
    }

    // ---- TARGET CHECKS (direction-aware; each TP hit once) ----
    const targets: Array<{ key: "tp1" | "tp2" | "tp3"; label: "TP1" | "TP2" | "TP3" }> = [
        { key: "tp1", label: "TP1" },
        { key: "tp2", label: "TP2" },
        { key: "tp3", label: "TP3" },
    ];

    const tpEventMap: Record<string, TradeState> = {
        TP1: "TP1_HIT",
        TP2: "TP2_HIT",
        TP3: "TP3_HIT",
    };

    let beApplied = false; // break-even applied during this pass

    for (const { key, label } of targets) {
        const target = state.config[key];
        if (target.hit) continue;
        // BUY: price must reach up to the target; SELL: price must fall to it.
        if (!reachedTarget(isBuy, currentPrice, target.price)) continue;

        // ---- TP hit ----
        target.hit = true;
        target.hitAt = Date.now();
        target.hitPrice = currentPrice;

        // Auto partial close at this target
        const closeVolume = computeCloseVolume(state, target.closePercent);
        let closeQueued = false;
        if (state.config.autoManagement && closeVolume > 0 && state.remainingVolume > 0) {
            const orderId = await queuePartialClose(uid, accountId, ticket, state, closeVolume, `${label}_PARTIAL`);
            if (orderId) {
                closeQueued = true;
                state.closeHistory.push({
                    target: label,
                    volume: closeVolume,
                    price: currentPrice,
                    timestamp: Date.now(),
                });
                state.remainingVolume = round2(Math.max(0, state.remainingVolume - closeVolume));
            }
        }

        await createTradeEvent(uid, accountId, ticket, `${label}_HIT` as TradeEventType, state, {
            targetPrice: target.price,
            hitPrice: currentPrice,
            closePercent: target.closePercent,
            closeVolume,
            closeQueued,
        });

        await sendNotification({
            userId: uid,
            event: `${label}_HIT`,
            title: `🎯 ${label} HIT — ${state.symbol} ${state.direction}`,
            message: `${label} reached at ${fmtPrice(currentPrice, state.symbol)}.\nEntry: ${fmtPrice(state.entry, state.symbol)}\nClose: ${closeVolume.toFixed(2)} lots (${target.closePercent}%)\nRemaining: ${state.remainingVolume.toFixed(2)} lots`,
            severity: "success",
            symbol: state.symbol,
            direction: state.direction,
            channels: ["in_app", "discord", "telegram"],
        });

        actions++;
        state.state = tpEventMap[label] as TradeState;

        // ---- Post-hit management ----
        if (state.config.autoManagement) {
            // Break-even after the configured trigger TP
            if (
                state.config.breakEvenEnabled &&
                state.config.breakEvenTrigger === label &&
                state.state !== "BE_APPLIED"
            ) {
                const bePrice = breakEvenPrice(state);
                const improves = isBuy ? bePrice > state.currentSl : bePrice < state.currentSl;
                if (improves) {
                    beApplied = true;
                    const ok = await queueModifySl(uid, accountId, ticket, state, bePrice, `${label}_BREAK_EVEN`, "AUTO");
                    if (ok) {
                        state.currentSl = bePrice;
                        state.state = "BE_APPLIED";
                        actions++;
                        await createTradeEvent(uid, accountId, ticket, "BREAK_EVEN_APPLIED", state, {
                            newSl: bePrice,
                        });
                        await sendNotification({
                            userId: uid,
                            event: "BREAK_EVEN_APPLIED",
                            title: `🔒 Break Even Applied — ${state.symbol} ${state.direction}`,
                            message: `SL moved to ${fmtPrice(bePrice, state.symbol)}.\nTrade is now risk-free.`,
                            severity: "success",
                            symbol: state.symbol,
                            direction: state.direction,
                            channels: ["in_app"],
                        });
                    }
                }
            }

            // Profit lock after the configured trigger TP
            // (skipped when break-even already handled this same TP transition)
            if (
                state.config.profitLockEnabled &&
                state.config.profitLockTrigger === label &&
                !beApplied
            ) {
                const lockSl = profitLockPrice(state, label);
                const improves = isBuy ? lockSl > state.currentSl : lockSl < state.currentSl;
                if (improves) {
                    const ok = await queueModifySl(uid, accountId, ticket, state, lockSl, `${label}_PROFIT_LOCK`, "AUTO");
                    if (ok) {
                        state.currentSl = lockSl;
                        state.state = "PROFIT_LOCKED";
                        state.lockedProfit = Math.abs(lockSl - state.entry) * state.remainingVolume * getContractSize(state.symbol);
                        actions++;
                        await createTradeEvent(uid, accountId, ticket, "PROFIT_LOCK_APPLIED", state, {
                            newSl: lockSl,
                            lockedProfit: state.lockedProfit,
                        });
                        await sendNotification({
                            userId: uid,
                            event: "PROFIT_LOCK_APPLIED",
                            title: `🔒 Profit Locked — ${state.symbol} ${state.direction}`,
                            message: `SL locked at ${fmtPrice(lockSl, state.symbol)}.\nLocked: ${fmtPoints(Math.abs(lockSl - state.entry), state.symbol)}\nRemaining: ${state.remainingVolume.toFixed(2)} lots`,
                            severity: "success",
                            symbol: state.symbol,
                            direction: state.direction,
                            channels: ["in_app"],
                        });
                    }
                }
            }
        }
    }

    // ---- Runner activation ----
    if (state.config.tp3.hit && !state.config.runnerActivated && state.config.runnerPercent > 0) {
        state.state = "RUNNER_ACTIVE";
        state.config.runnerActivated = true;
        await createTradeEvent(uid, accountId, ticket, "RUNNER_ACTIVE", state, {
            runnerVolume: state.remainingVolume,
            trailingType: state.config.trailingType,
        });
        await sendNotification({
            userId: uid,
            event: "RUNNER_ACTIVE",
            title: `🏃 Runner Active — ${state.symbol} ${state.direction}`,
            message: `Runner: ${state.remainingVolume.toFixed(2)} lots\nTrailing: ${state.config.trailingType} ${state.config.trailingType === "atr" ? `(x${state.config.trailingAtrMultiplier})` : ""}`,
            severity: "info",
            symbol: state.symbol,
            direction: state.direction,
            channels: ["in_app"],
        });
        actions++;
    }

    // ---- Approaching alerts (cooldown-guarded) ----
    const approachThreshold = await approachingThreshold(state.symbol);
    for (const { key, label } of targets) {
        const target = state.config[key];
        if (target.hit) continue;
        const dist = Math.abs(target.price - currentPrice);
        if (dist <= approachThreshold && !reachedTarget(isBuy, currentPrice, target.price)) {
            if (Date.now() - (target.lastApproachAt || 0) > APPROACH_COOLDOWN_MS) {
                state.state = state.state === "RUNNER_ACTIVE" || state.state === "TRAILING"
                    ? state.state
                    : (`${label}_APPROACHING` as TradeState);
                target.lastApproachAt = Date.now();
                await createTradeEvent(uid, accountId, ticket, `${label}_APPROACHING` as TradeEventType, state, {
                    targetPrice: target.price,
                    distance: dist,
                });
            }
            break; // only alert for the nearest unfilled target
        }
    }

    try {
        await saveTradeState(state);
    } catch (err) {
        console.error(`[trade-management/monitor] save failed for ${ticket}:`, err);
    }
    return { monitored: true, actions };
}

// ============================================
// TRAILING STOP
// ============================================

function maybeTrailRunner(state: TradeManagementState, currentPrice: number): boolean {
    const { config, direction } = state;
    if (!config.trailingEnabled) return false;
    const active = state.state === "RUNNER_ACTIVE" || state.state === "TRAILING";
    if (!active) return false;

    const isBuy = direction === "BUY";
    let candidate: number | null = null;

    if (config.trailingType === "atr") {
        const atr = Number(state.config.trailingAtrValue || 0);
        if (atr > 0) {
            candidate = isBuy ? currentPrice - atr * config.trailingAtrMultiplier : currentPrice + atr * config.trailingAtrMultiplier;
        }
    } else if (config.trailingType === "percent") {
        const pct = Math.abs(config.trailingDistance) > 0 ? config.trailingDistance / 10000 : 0.001;
        candidate = isBuy ? currentPrice * (1 - pct) : currentPrice * (1 + pct);
    } else {
        // fixed distance (points)
        const dist = config.trailingDistance || 0;
        if (dist > 0) {
            candidate = isBuy ? currentPrice - dist : currentPrice + dist;
        }
    }

    if (candidate === null) return false;
    // Only tighten (ratchet): never loosen the stop.
    const improves = isBuy ? candidate > state.currentSl : candidate < state.currentSl;
    if (!improves) return false;

    state.currentSl = roundDigits(candidate, state.symbol);
    state.state = "TRAILING";
    return true;
}

// ============================================
// MGMT HELPERS
// ============================================

const APPROACH_COOLDOWN_MS = 5 * 60 * 1000;

function reachedTarget(isBuy: boolean, currentPrice: number, targetPrice: number): boolean {
    return isBuy ? currentPrice >= targetPrice : currentPrice <= targetPrice;
}

function isBuyState(state: TradeManagementState): boolean {
    return state.direction === "BUY";
}

function closeHistoryVolume(state: TradeManagementState): number {
    return state.closeHistory.reduce((sum, ch) => sum + (ch.volume || 0), 0);
}

function computeCloseVolume(state: TradeManagementState, closePercent: number): number {
    const raw = (state.volume * closePercent) / 100;
    // Snap to 0.01 lot grid, never exceed what remains.
    return Math.min(round2(raw), round2(state.remainingVolume));
}

function breakEvenPrice(state: TradeManagementState): number {
    const offset = state.config.breakEvenOffset || 0;
    return isBuyState(state) ? state.entry + offset : state.entry - offset;
}

function profitLockPrice(state: TradeManagementState, triggerLabel: string): number {
    // Lock at the previous TP price (TP2 hit -> lock at TP1, TP3 hit -> lock at TP2).
    const prev = triggerLabel === "TP2" ? state.config.tp1.price : triggerLabel === "TP3" ? state.config.tp2.price : state.entry;
    return prev;
}

function approachingThreshold(symbol: string): Promise<number> {
    // Per-symbol fallback when admin defaults are not configured.
    return adminDatabase
        .ref("settings/tradeManagementDefaults/approachingAlerts")
        .get()
        .then((snap) => {
            const v = snap.val();
            return Number(v?.distanceThreshold) > 0 ? Number(v.distanceThreshold) : getDefaultThreshold(symbol);
        })
        .catch(() => getDefaultThreshold(symbol));
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function roundDigits(price: number, symbol: string): number {
    const digits = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("BTC") ? 2 : 5;
    return Number(price.toFixed(digits));
}

function fmtPrice(price: number, symbol: string): string {
    const digits = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("BTC") ? 2 : 5;
    return price.toFixed(digits);
}

function fmtPoints(points: number, symbol: string): string {
    const digits = symbol.includes("JPY") ? 1 : symbol.includes("XAU") || symbol.includes("BTC") ? 1 : 3;
    return points.toFixed(digits) + " pts";
}

function getContractSize(symbol: string): number {
    if (symbol.includes("XAU")) return 100;
    if (symbol.includes("BTC") || symbol.includes("ETH")) return 1;
    if (symbol.includes("US30") || symbol.includes("NAS")) return 1;
    return 100000;
}

function getDefaultThreshold(symbol: string): number {
    if (symbol.includes("XAU")) return 2;
    if (symbol.includes("BTC")) return 50;
    if (symbol.includes("US30") || symbol.includes("NAS")) return 5;
    return 0.0005; // 5 pips for forex
}
