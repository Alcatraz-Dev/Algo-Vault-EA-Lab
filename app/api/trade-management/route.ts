import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    getTradeState,
    saveTradeState,
    createTradeState,
    transitionState,
    generateRecommendations,
    getTradeEvents,
    queueModifySl,
    queueFullClose,
    queuePartialClose,
} from "@/lib/trade-management/service";
import {
    TradeManagementConfig,
    TradeManagementState,
    TradeDirection,
} from "@/lib/trade-management/types";

// ============================================
// GET: List all managed trades or get single trade
// ============================================

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const accountId = searchParams.get("accountId");
        const ticket = searchParams.get("ticket");

        if (ticket && accountId) {
            // Single trade
            const state = await getTradeState(user.uid, accountId, ticket);
            if (!state) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

            const events = await getTradeEvents(user.uid, accountId, ticket);
            const recommendations = generateRecommendations(state);

            return NextResponse.json({ success: true, trade: state, events, recommendations });
        }

        if (accountId) {
            // All trades for account
            const snap = await adminDatabase.ref(`tradeManagement/${user.uid}/${accountId}`).get();
            if (!snap.exists()) return NextResponse.json({ success: true, trades: [] });

            const trades: TradeManagementState[] = [];
            snap.forEach((child) => {
                trades.push(child.val() as TradeManagementState);
            });

            return NextResponse.json({ success: true, trades });
        }

        // All trades across all accounts
        const snap = await adminDatabase.ref(`tradeManagement/${user.uid}`).get();
        if (!snap.exists()) return NextResponse.json({ success: true, trades: [] });

        const allTrades: TradeManagementState[] = [];
        snap.forEach((accountSnap) => {
            accountSnap.forEach((tradeSnap) => {
                allTrades.push(tradeSnap.val() as TradeManagementState);
            });
        });

        return NextResponse.json({ success: true, trades: allTrades });
    } catch (err) {
        console.error("Trade management GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// POST: Create trade management for a position
// ============================================

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const {
            accountId,
            ticket,
            symbol,
            direction,
            entry,
            sl,
            volume,
            config,
        } = body as {
            accountId: string;
            ticket: string;
            symbol: string;
            direction: TradeDirection;
            entry: number;
            sl: number;
            volume: number;
            config: TradeManagementConfig;
        };

        // Validation
        if (!accountId || !ticket || !symbol || !direction || !entry || !sl || !volume || !config) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Validate TP percentages sum
        const totalPercent = config.tp1.closePercent + config.tp2.closePercent + config.tp3.closePercent + config.runnerPercent;
        if (totalPercent > 100) {
            return NextResponse.json({ error: `TP percentages sum to ${totalPercent}%, exceeds 100%` }, { status: 400 });
        }

        // Check ownership
        const accountSnap = await adminDatabase.ref(`trading_accounts/${user.uid}/${accountId}`).get();
        if (!accountSnap.exists()) {
            return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        // Check existing
        const existing = await getTradeState(user.uid, accountId, ticket);
        if (existing) {
            return NextResponse.json({ error: "Trade management already exists for this ticket" }, { status: 409 });
        }

        // Create state
        const state = createTradeState(user.uid, accountId, ticket, symbol, direction, entry, sl, volume, config);
        await saveTradeState(state);

        // Create initial event
        const { createTradeEvent } = await import("@/lib/trade-management/service");
        await createTradeEvent(user.uid, accountId, ticket, "TRADE_OPENED", state, {
            entry, sl, volume,
        });

        return NextResponse.json({ success: true, trade: state });
    } catch (err) {
        console.error("Trade management POST error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// PUT: Update trade state / config / manual actions
// ============================================

export async function PUT(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { accountId, ticket, action, config, newState, reason, manualOverride, overrideReason } = body;

        if (!accountId || !ticket) {
            return NextResponse.json({ error: "accountId and ticket required" }, { status: 400 });
        }

        const state = await getTradeState(user.uid, accountId, ticket);
        if (!state) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

        // Check ownership
        const accountSnap = await adminDatabase.ref(`trading_accounts/${user.uid}/${accountId}`).get();
        if (!accountSnap.exists()) {
            return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        if (action === "transition" && newState) {
            const success = await transitionState(user.uid, accountId, ticket, newState, reason || "Manual update");
            if (!success) return NextResponse.json({ error: "Invalid state transition" }, { status: 400 });
            const updated = await getTradeState(user.uid, accountId, ticket);
            return NextResponse.json({ success: true, trade: updated });
        }

        if (action === "updateConfig" && config) {
            state.config = { ...state.config, ...config };
            state.lastUpdated = Date.now();
            await saveTradeState(state);
            return NextResponse.json({ success: true, trade: state });
        }

        if (action === "updatePrice" && body.currentPrice !== undefined) {
            state.currentPrice = body.currentPrice;
            state.lastCheckedAt = Date.now();
            await saveTradeState(state);
            return NextResponse.json({ success: true, trade: state });
        }

        if (action === "updateSl" && body.newSl !== undefined) {
            const oldSl = state.currentSl;
            const newSl = Number(body.newSl);

            // Safety: never worsen SL (ratchet-only)
            if (state.direction === "BUY" && newSl < oldSl) {
                return NextResponse.json({ error: "Cannot move BUY SL downward" }, { status: 400 });
            }
            if (state.direction === "SELL" && newSl > oldSl) {
                return NextResponse.json({ error: "Cannot move SELL SL upward" }, { status: 400 });
            }

            // Queue the MODIFY through the gateway execution path.
            const queued = await queueModifySl(user.uid, accountId, ticket, state, newSl, reason || "Manual SL update", "MANUAL");
            if (!queued) {
                return NextResponse.json({ error: "Failed to queue SL modification" }, { status: 500 });
            }

            state.currentSl = newSl;
            state.lastUpdated = Date.now();
            await saveTradeState(state);

            return NextResponse.json({ success: true, trade: state });
        }

        if (action === "closeAtMarket") {
            if (["CLOSED", "STOPPED", "CANCELLED"].includes(state.state)) {
                return NextResponse.json({ error: "Trade already closed" }, { status: 400 });
            }

            const orderId = await queueFullClose(user.uid, accountId, ticket, state, reason || "Manual close at market");
            if (!orderId) {
                return NextResponse.json({ error: "Failed to queue close order" }, { status: 500 });
            }

            // Mark managed state closed; the monitor reconciles the actual
            // position removal from trading_positions.
            state.manualOverride = true;
            state.overrideReason = "Manual close queued";
            state.lastUpdated = Date.now();
            await saveTradeState(state);
            await transitionState(user.uid, accountId, ticket, "CLOSED", "Manual close queued");

            return NextResponse.json({ success: true, orderId });
        }

        if (action === "closePartial" && body.closeVolume !== undefined) {
            const closeVolume = Number(body.closeVolume);
            const available = state.remainingVolume || state.volume;

            if (!(closeVolume > 0) || closeVolume > available + 1e-8) {
                return NextResponse.json({ error: `Invalid volume. Available: ${available.toFixed(2)} lots` }, { status: 400 });
            }
            if (closeVolume >= available - 1e-8) {
                // Full close via the partial path — treat as closeAtMarket.
                const orderId = await queueFullClose(user.uid, accountId, ticket, state, reason || "Manual close (full) via partial");
                if (!orderId) return NextResponse.json({ error: "Failed to queue close order" }, { status: 500 });
                state.manualOverride = true;
                state.overrideReason = "Manual close queued";
                await saveTradeState(state);
                await transitionState(user.uid, accountId, ticket, "CLOSED", "Manual close queued");
                return NextResponse.json({ success: true, orderId, full: true });
            }

            const orderId = await queuePartialClose(user.uid, accountId, ticket, state, closeVolume, reason || "Manual partial close");
            if (!orderId) {
                return NextResponse.json({ error: "Failed to queue partial close" }, { status: 500 });
            }

            state.remainingVolume = Math.round((available - closeVolume) * 100) / 100;
            state.closeHistory.push({
                target: "MANUAL",
                volume: closeVolume,
                price: state.currentPrice,
                timestamp: Date.now(),
            });
            state.lastUpdated = Date.now();
            await saveTradeState(state);

            return NextResponse.json({ success: true, orderId, trade: state });
        }

        if (action === "setTp" && body.tp !== undefined && body.target) {
            // Adjust an individual target price (tp1 | tp2 | tp3)
            const key = String(body.target);
            if (!["tp1", "tp2", "tp3"].includes(key)) {
                return NextResponse.json({ error: "Invalid target key" }, { status: 400 });
            }
            const tp = Number(body.tp);
            if (!(tp > 0)) {
                return NextResponse.json({ error: "Invalid TP price" }, { status: 400 });
            }
            if (state.config[key as "tp1" | "tp2" | "tp3"].hit) {
                return NextResponse.json({ error: "Target already hit" }, { status: 400 });
            }

            state.config[key as "tp1" | "tp2" | "tp3"].price = tp;
            state.currentTp = tp; // broker TP follows the nearest unfilled target
            state.lastUpdated = Date.now();
            await saveTradeState(state);

            await queueOrderRequestForTp(user.uid, accountId, ticket, state, reason || "Manual TP update");

            return NextResponse.json({ success: true, trade: state });
        }

        if (manualOverride !== undefined) {
            state.manualOverride = manualOverride;
            state.overrideReason = overrideReason;
            state.lastUpdated = Date.now();
            await saveTradeState(state);
            return NextResponse.json({ success: true, trade: state });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (err) {
        console.error("Trade management PUT error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// HELPERS
// ============================================

// Push the updated broker TP to MT5 whenever a target is edited.
async function queueOrderRequestForTp(
    uid: string,
    accountId: string,
    ticket: string,
    state: TradeManagementState,
    reason: string
): Promise<void> {
    try {
        await queueModifySl(uid, accountId, ticket, state, state.currentSl, reason, "MANUAL");
    } catch (err) {
        console.error("TP modify queue failed:", err);
    }
}

// ============================================
// DELETE: Remove trade management
// ============================================

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const accountId = searchParams.get("accountId");
        const ticket = searchParams.get("ticket");

        if (!accountId || !ticket) {
            return NextResponse.json({ error: "accountId and ticket required" }, { status: 400 });
        }

        await adminDatabase.ref(`tradeManagement/${user.uid}/${accountId}/${ticket}`).remove();
        await adminDatabase.ref(`tradeEvents/${user.uid}/${accountId}/${ticket}`).remove();

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Trade management DELETE error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
