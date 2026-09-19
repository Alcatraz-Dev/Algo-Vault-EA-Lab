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
            const newSl = body.newSl;

            // Safety: never worsen SL
            if (state.direction === "BUY" && newSl < oldSl) {
                return NextResponse.json({ error: "Cannot move BUY SL downward" }, { status: 400 });
            }
            if (state.direction === "SELL" && newSl > oldSl) {
                return NextResponse.json({ error: "Cannot move SELL SL upward" }, { status: 400 });
            }

            state.currentSl = newSl;
            state.lastUpdated = Date.now();
            await saveTradeState(state);

            // Audit log
            const { logAudit } = await import("@/lib/trade-management/service");
            await logAudit(user.uid, accountId, ticket, "MOVE_SL", {
                oldSL: oldSl,
                newSL: newSl,
                reason: reason || "Manual SL update",
                mode: "MANUAL",
                status: "SUCCESS",
            });

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
