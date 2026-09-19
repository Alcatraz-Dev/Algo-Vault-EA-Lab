import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    getTradeState,
    saveTradeState,
    transitionState,
    createTradeEvent,
    logAudit,
} from "@/lib/trade-management/service";
import { sendNotification } from "@/lib/trade-management/notifications";
import {
    TradeManagementState,
    TradeDirection,
    TradeEventType,
} from "@/lib/trade-management/types";

// ============================================
// POST: Monitor all open managed trades
// Called by cron or heartbeat
// ============================================

export async function POST(request: NextRequest) {
    try {
        // Verify cron secret
        const secret = request.headers.get("x-cron-secret");
        if (secret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const { accountId, userId } = body as { accountId?: string; userId?: string };

        // Get all managed trades that are active (not CLOSED/STOPPED)
        let tradesRef;
        if (userId && accountId) {
            tradesRef = adminDatabase.ref(`tradeManagement/${userId}/${accountId}`);
        } else if (userId) {
            tradesRef = adminDatabase.ref(`tradeManagement/${userId}`);
        } else {
            // Scan all users - for cron
            tradesRef = adminDatabase.ref("tradeManagement");
        }

        const snapshot = await tradesRef.get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, monitored: 0, actions: 0 });
        }

        let monitored = 0;
        let actions = 0;

        const processTrade = async (uid: string, accountId: string, ticket: string, state: TradeManagementState) => {
            // Skip closed/stopped trades
            if (["CLOSED", "STOPPED"].includes(state.state)) return;

            // Skip if manual override
            if (state.manualOverride) return;

            // Skip if recently checked (within 30 seconds)
            if (Date.now() - state.lastCheckedAt < 30000) return;

            monitored++;

            // Get current price from MT5 positions
            const positionsSnap = await adminDatabase.ref(`trading_positions/${uid}/${accountId}`).get();
            if (!positionsSnap.exists()) return;

            const positions = positionsSnap.val();
            const position = positions[ticket];

            if (!position) {
                // Position not found - might be closed
                await transitionState(uid, accountId, ticket, "CLOSED", "Position no longer exists on MT5");
                return;
            }

            const currentPrice = position.currentPrice || position.price || 0;
            if (!currentPrice) return;

            // Update price
            state.currentPrice = currentPrice;
            state.lastCheckedAt = Date.now();

            // Calculate PnL
            const contractSize = getContractSize(state.symbol);
            const pointValue = contractSize * (state.symbol.includes("JPY") ? 0.01 : 0.0001);

            if (state.direction === "BUY") {
                state.currentPnl = (currentPrice - state.entry) * contractSize;
            } else {
                state.currentPnl = (state.entry - currentPrice) * contractSize;
            }

            // Calculate R-multiple
            const riskAmount = Math.abs(state.entry - state.currentSl) * contractSize;
            state.currentR = riskAmount > 0 ? state.currentPnl / riskAmount : 0;

            // Update remaining volume
            state.remainingVolume = position.volume || state.volume;

            // Check targets
            const checkResult = await checkTargets(uid, accountId, ticket, state, currentPrice);

            if (checkResult.actionTaken) {
                actions++;
            }

            await saveTradeState(state);
        };

        // Process all trades
        if (userId && accountId) {
            // Single account
            const tradesSnap = await adminDatabase.ref(`tradeManagement/${userId}/${accountId}`).get();
            if (tradesSnap.exists()) {
                for (const [ticket, tradeRaw] of Object.entries(tradesSnap.val())) {
                    await processTrade(userId, accountId, ticket, tradeRaw as TradeManagementState);
                }
            }
        } else {
            // All users
            const usersSnap = await snapshot;
            for (const [uid, accountsRaw] of Object.entries(usersSnap.val() as Record<string, Record<string, Record<string, TradeManagementState>>>)) {
                for (const [accId, tradesRaw] of Object.entries(accountsRaw)) {
                    for (const [ticket, tradeRaw] of Object.entries(tradesRaw)) {
                        await processTrade(uid, accId, ticket, tradeRaw as TradeManagementState);
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
// TARGET CHECKING
// ============================================

async function checkTargets(
    uid: string,
    accountId: string,
    ticket: string,
    state: TradeManagementState,
    currentPrice: number
): Promise<{ actionTaken: boolean }> {
    let actionTaken = false;
    const { direction, config } = state;
    const isBuy = direction === "BUY";

    // Helper: check if price reached target
    const reached = (target: number) => isBuy ? currentPrice >= target : currentPrice <= target;
    const approaching = (target: number, threshold: number) => {
        const dist = Math.abs(target - currentPrice);
        return dist <= threshold && !reached(target);
    };

    // Get approaching threshold from admin defaults
    const defaultsSnap = await adminDatabase.ref("settings/tradeManagementDefaults").get();
    const defaults = defaultsSnap.val();
    const approachThreshold = defaults?.approachingAlerts?.distanceThreshold || getDefaultThreshold(state.symbol);
    const cooldownMs = defaults?.approachingAlerts?.cooldownMs || 300000; // 5 min

    // ---- TP1 ----
    if (state.state === "OPEN" || state.state === "TP1_APPROACHING") {
        if (reached(config.tp1.price) && !config.tp1.hit) {
            // TP1 HIT
            config.tp1.hit = true;
            config.tp1.hitAt = Date.now();
            config.tp1.hitPrice = currentPrice;
            state.state = "TP1_HIT";

            await createTradeEvent(uid, accountId, ticket, "TP1_HIT", state, {
                targetPrice: config.tp1.price,
                hitPrice: currentPrice,
                closePercent: config.tp1.closePercent,
            });

            await sendNotification({
                userId: uid,
                event: "TP1_HIT",
                title: `🎯 TP1 HIT — ${state.symbol} ${direction}`,
                message: `TP1 reached at ${formatPrice(currentPrice, state.symbol)}.\n\nSuggested: Move SL to Break Even.\n\nEntry: ${formatPrice(state.entry, state.symbol)}\nCurrent: ${formatPrice(currentPrice, state.symbol)}\nTP2: ${formatPrice(config.tp2.price, state.symbol)}`,
                severity: "success",
                symbol: state.symbol,
                direction,
                channels: ["in_app", "discord", "telegram"],
            });

            actionTaken = true;

            // Auto-break even if enabled
            if (config.autoManagement && config.breakEvenEnabled && config.breakEvenTrigger === "TP1") {
                const newSl = calculateBreakEven(state);
                if (newSl !== state.currentSl) {
                    const success = await executeSlMove(uid, accountId, ticket, state, newSl, "TP1_HIT_BE");
                    if (success) {
                        state.state = "BE_APPLIED";
                        state.currentSl = newSl;

                        await createTradeEvent(uid, accountId, ticket, "BREAK_EVEN_APPLIED", state, {
                            oldSl: state.currentSl,
                            newSl,
                        });

                        await sendNotification({
                            userId: uid,
                            event: "BREAK_EVEN_APPLIED",
                            title: `🔒 Break Even Applied — ${state.symbol} ${direction}`,
                            message: `SL moved to ${formatPrice(newSl, state.symbol)}.\n\nTrade is now risk-free.`,
                            severity: "success",
                            symbol: state.symbol,
                            direction,
                            channels: ["in_app"],
                        });
                    }
                }
            }
        } else if (approaching(config.tp1.price, approachThreshold) && state.state === "OPEN") {
            // TP1 APPROACHING
            state.state = "TP1_APPROACHING";
            const lastApproaching = config.tp1.eventIds.find((id) => id.includes("approach"));
            if (!lastApproaching || Date.now() - cooldownMs > 0) {
                await createTradeEvent(uid, accountId, ticket, "TP1_APPROACHING", state, {
                    targetPrice: config.tp1.price,
                    distance: Math.abs(config.tp1.price - currentPrice),
                });
                config.tp1.eventIds.push(`approach_${Date.now()}`);
            }
        }
    }

    // ---- TP2 ----
    if (state.state === "TP2_APPROACHING" || state.state === "BE_APPLIED" || state.state === "TP1_HIT") {
        if (reached(config.tp2.price) && !config.tp2.hit) {
            config.tp2.hit = true;
            config.tp2.hitAt = Date.now();
            config.tp2.hitPrice = currentPrice;
            state.state = "TP2_HIT";

            await createTradeEvent(uid, accountId, ticket, "TP2_HIT", state, {
                targetPrice: config.tp2.price,
                hitPrice: currentPrice,
                closePercent: config.tp2.closePercent,
            });

            await sendNotification({
                userId: uid,
                event: "TP2_HIT",
                title: `🎯 TP2 HIT — ${state.symbol} ${direction}`,
                message: `TP2 reached at ${formatPrice(currentPrice, state.symbol)}.\n\nConsider locking profit.\n\nLocked: ${formatPrice(config.tp1.price, state.symbol)}\nTP3: ${formatPrice(config.tp3.price, state.symbol)}`,
                severity: "success",
                symbol: state.symbol,
                direction,
                channels: ["in_app", "discord", "telegram"],
            });

            actionTaken = true;

            // Auto profit lock
            if (config.autoManagement && config.profitLockEnabled && config.profitLockTrigger === "TP2") {
                const newSl = config.tp1.price; // Lock at TP1
                if (newSl !== state.currentSl) {
                    const success = await executeSlMove(uid, accountId, ticket, state, newSl, "TP2_HIT_PROFIT_LOCK");
                    if (success) {
                        state.state = "PROFIT_LOCKED";
                        state.currentSl = newSl;
                        state.lockedProfit = Math.abs(newSl - state.entry) * getContractSize(state.symbol);

                        await createTradeEvent(uid, accountId, ticket, "PROFIT_LOCK_APPLIED", state, {
                            oldSl: state.currentSl,
                            newSl,
                            lockedProfit: state.lockedProfit,
                        });

                        await sendNotification({
                            userId: uid,
                            event: "PROFIT_LOCK_APPLIED",
                            title: `🔒 Profit Locked — ${state.symbol} ${direction}`,
                            message: `Profit locked at ${formatPrice(newSl, state.symbol)}.\n\nLocked: +${formatPoints(Math.abs(newSl - state.entry), state.symbol)}\nTP3: ${formatPrice(config.tp3.price, state.symbol)}`,
                            severity: "success",
                            symbol: state.symbol,
                            direction,
                            channels: ["in_app"],
                        });
                    }
                }
            }
        } else if (approaching(config.tp2.price, approachThreshold) && state.state !== "TP2_APPROACHING" && !config.tp2.hit) {
            state.state = "TP2_APPROACHING";
            await createTradeEvent(uid, accountId, ticket, "TP2_APPROACHING", state, {
                targetPrice: config.tp2.price,
                distance: Math.abs(config.tp2.price - currentPrice),
            });
        }
    }

    // ---- TP3 ----
    if (state.state === "TP3_APPROACHING" || state.state === "PROFIT_LOCKED" || state.state === "TP2_HIT") {
        if (reached(config.tp3.price) && !config.tp3.hit) {
            config.tp3.hit = true;
            config.tp3.hitAt = Date.now();
            config.tp3.hitPrice = currentPrice;
            state.state = "TP3_HIT";

            await createTradeEvent(uid, accountId, ticket, "TP3_HIT", state, {
                targetPrice: config.tp3.price,
                hitPrice: currentPrice,
                closePercent: config.tp3.closePercent,
                runnerPercent: config.runnerPercent,
            });

            await sendNotification({
                userId: uid,
                event: "TP3_HIT",
                title: `🎯 TP3 HIT — ${state.symbol} ${direction}`,
                message: `All targets achieved!\nRunner: ${config.runnerPercent}% remaining.`,
                severity: "success",
                symbol: state.symbol,
                direction,
                channels: ["in_app", "discord", "telegram"],
            });

            actionTaken = true;

            // Activate runner
            if (config.runnerPercent > 0) {
                state.state = "RUNNER_ACTIVE";
                await createTradeEvent(uid, accountId, ticket, "RUNNER_ACTIVE", state, {
                    runnerVolume: state.volume * (config.runnerPercent / 100),
                    trailingType: config.trailingType,
                });

                await sendNotification({
                    userId: uid,
                    event: "RUNNER_ACTIVE",
                    title: `🏃 Runner Active — ${state.symbol} ${direction}`,
                    message: `Runner: ${formatVolume(state.volume * (config.runnerPercent / 100))} lots\nTrailing: ${config.trailingType}`,
                    severity: "info",
                    symbol: state.symbol,
                    direction,
                    channels: ["in_app"],
                });
            }
        } else if (approaching(config.tp3.price, approachThreshold) && state.state !== "TP3_APPROACHING" && !config.tp3.hit) {
            state.state = "TP3_APPROACHING";
            await createTradeEvent(uid, accountId, ticket, "TP3_APPROACHING", state, {
                targetPrice: config.tp3.price,
                distance: Math.abs(config.tp3.price - currentPrice),
            });
        }
    }

    // ---- STOP LOSS CHECK ----
    if (reached(state.currentSl) && !["CLOSED", "STOPPED"].includes(state.state)) {
        state.state = "STOPPED";

        await createTradeEvent(uid, accountId, ticket, "STOP_LOSS_HIT", state, {
            slPrice: state.currentSl,
            hitPrice: currentPrice,
        });

        await sendNotification({
            userId: uid,
            event: "STOP_LOSS_HIT",
            title: `🛑 Stop Loss Hit — ${state.symbol} ${direction}`,
            message: `SL hit at ${formatPrice(currentPrice, state.symbol)}.\nEntry: ${formatPrice(state.entry, state.symbol)}`,
            severity: "error",
            symbol: state.symbol,
            direction,
            channels: ["in_app", "discord", "telegram"],
        });
    }

    return { actionTaken };
}

// ============================================
// BREAK EVEN CALCULATION
// ============================================

function calculateBreakEven(state: TradeManagementState): number {
    const { direction, entry, config } = state;
    const offset = config.breakEvenOffset || 0;

    if (direction === "BUY") {
        return entry + offset; // SL moves UP to entry + buffer
    } else {
        return entry - offset; // SL moves DOWN to entry - buffer
    }
}

// ============================================
// SL MOVE EXECUTION
// ============================================

async function executeSlMove(
    uid: string,
    accountId: string,
    ticket: string,
    state: TradeManagementState,
    newSl: number,
    reason: string
): Promise<boolean> {
    try {
        // Create modify order
        const clientOrderId = `mgmt_${accountId}_${ticket}_${reason}_${Date.now()}`;
        const accountNumber = accountId.replace("gateway_", "");

        await adminDatabase.ref(`trading_order_requests/${uid}/${clientOrderId}`).set({
            clientOrderId,
            accountId,
            symbol: state.symbol,
            action: "MODIFY",
            volume: 0,
            sl: newSl,
            tp: state.currentTp,
            closeTicket: Number(ticket),
            status: "queued",
            userId: uid,
            source: "trade_management",
            reason,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        // Audit
        await logAudit(uid, accountId, ticket, "MOVE_SL", {
            oldSL: state.currentSl,
            newSL: newSl,
            reason,
            mode: state.config.autoManagement ? "AUTO" : "MANUAL",
            status: "SUCCESS",
        });

        return true;
    } catch (err) {
        console.error("SL move execution failed:", err);
        await logAudit(uid, accountId, ticket, "MOVE_SL", {
            oldSL: state.currentSl,
            newSL: newSl,
            reason,
            mode: state.config.autoManagement ? "AUTO" : "MANUAL",
            status: "FAILED",
            errorMessage: String(err),
        });
        return false;
    }
}

// ============================================
// HELPERS
// ============================================

function formatPrice(price: number, symbol: string): string {
    const digits = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("BTC") ? 2 : 5;
    return price.toFixed(digits);
}

function formatPoints(points: number, symbol: string): string {
    const digits = symbol.includes("JPY") ? 1 : symbol.includes("XAU") || symbol.includes("BTC") ? 1 : 3;
    return points.toFixed(digits) + " pts";
}

function formatVolume(vol: number): string {
    return vol.toFixed(2);
}

function getContractSize(symbol: string): number {
    if (symbol.includes("XAU")) return 100;
    if (symbol.includes("BTC") || symbol.includes("ETH")) return 1;
    if (symbol.includes("US30") || symbol.includes("NAS")) return 1;
    return 100000;
}

function getDefaultThreshold(symbol: string): number {
    // Default approaching threshold in price points
    if (symbol.includes("XAU")) return 2; // 2 points for gold
    if (symbol.includes("BTC")) return 50; // 50 points for BTC
    if (symbol.includes("US30") || symbol.includes("NAS")) return 5;
    return 0.0005; // 5 pips for forex
}
