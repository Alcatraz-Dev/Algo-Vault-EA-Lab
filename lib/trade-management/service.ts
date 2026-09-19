import { adminDatabase } from "@/lib/firebase-admin";
import {
    TradeManagementState,
    TradeManagementConfig,
    TradeState,
    TradeEvent,
    TradeEventType,
    TradeEventSeverity,
    TargetConfig,
    AuditLogEntry,
    AuditAction,
    TradeDirection,
    Recommendation,
} from "./types";

// ============================================
// STATE MACHINE TRANSITIONS
// ============================================

const VALID_TRANSITIONS: Record<TradeState, TradeState[]> = {
    PENDING: ["OPEN", "CLOSED", "STOPPED", "CANCELLED"],
    OPEN: ["TP1_APPROACHING", "TP1_HIT", "TP2_APPROACHING", "TP2_HIT", "TP3_APPROACHING", "TP3_HIT", "CLOSED", "STOPPED"],
    TP1_APPROACHING: ["TP1_HIT", "CLOSED", "STOPPED"],
    TP1_HIT: ["BE_PENDING", "BE_APPLIED", "TP2_APPROACHING", "TP2_HIT", "CLOSED", "STOPPED"],
    BE_PENDING: ["BE_APPLIED", "TP2_APPROACHING", "TP2_HIT", "CLOSED", "STOPPED"],
    BE_APPLIED: ["TP2_APPROACHING", "TP2_HIT", "CLOSED", "STOPPED"],
    TP2_APPROACHING: ["TP2_HIT", "CLOSED", "STOPPED"],
    TP2_HIT: ["PROFIT_LOCKED", "TP3_APPROACHING", "TP3_HIT", "CLOSED", "STOPPED"],
    PROFIT_LOCKED: ["TP3_APPROACHING", "TP3_HIT", "CLOSED", "STOPPED"],
    TP3_APPROACHING: ["TP3_HIT", "CLOSED", "STOPPED"],
    TP3_HIT: ["RUNNER_ACTIVE", "TRAILING", "CLOSED", "STOPPED"],
    RUNNER_ACTIVE: ["TRAILING", "CLOSED", "STOPPED"],
    TRAILING: ["CLOSED", "STOPPED"],
    CLOSED: [],
    STOPPED: ["OPEN"],
    CANCELLED: [],
};

// ============================================
// DATABASE PATHS
// ============================================

function tradeMgmtPath(uid: string, accountId: string, ticket?: string) {
    const base = `tradeManagement/${uid}/${accountId}`;
    return ticket ? `${base}/${ticket}` : base;
}

function tradeEventsPath(uid: string, accountId: string, ticket?: string) {
    const base = `tradeEvents/${uid}/${accountId}`;
    return ticket ? `${base}/${ticket}` : base;
}

function auditLogPath(uid: string, accountId: string) {
    return `tradeAuditLog/${uid}/${accountId}`;
}

// ============================================
// STATE MANAGEMENT
// ============================================

export async function getTradeState(
    uid: string,
    accountId: string,
    ticket: string
): Promise<TradeManagementState | null> {
    const snap = await adminDatabase.ref(tradeMgmtPath(uid, accountId, ticket)).get();
    if (!snap.exists()) return null;
    return snap.val() as TradeManagementState;
}

export async function saveTradeState(state: TradeManagementState): Promise<void> {
    state.lastUpdated = Date.now();
    await adminDatabase.ref(tradeMgmtPath(state.userId, state.accountId, state.ticket)).set(state);
}

export async function updateTradeState(
    uid: string,
    accountId: string,
    ticket: string,
    updates: Partial<TradeManagementState>
): Promise<void> {
    updates.lastUpdated = Date.now();
    await adminDatabase.ref(tradeMgmtPath(uid, accountId, ticket)).update(updates);
}

// ============================================
// STATE TRANSITION
// ============================================

export function canTransition(current: TradeState, next: TradeState): boolean {
    return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}

export async function transitionState(
    uid: string,
    accountId: string,
    ticket: string,
    newState: TradeState,
    reason: string
): Promise<boolean> {
    const state = await getTradeState(uid, accountId, ticket);
    if (!state) return false;

    if (!canTransition(state.state, newState)) {
        console.error(`Invalid transition: ${state.state} -> ${newState} for ${ticket}`);
        return false;
    }

    const oldState = state.state;
    state.state = newState;
    state.lastUpdated = Date.now();
    await saveTradeState(state);

    // Log the transition
    await logAudit(uid, accountId, ticket, "STATE_TRANSITION", {
        reason: `${oldState} -> ${newState}: ${reason}`,
        mode: state.config.autoManagement ? "AUTO" : "MANUAL",
        status: "SUCCESS",
    });

    // Create event
    await createTradeEvent(uid, accountId, ticket, mapStateToEvent(newState), state, {
        oldState,
        newState,
        reason,
    });

    return true;
}

function mapStateToEvent(state: TradeState): TradeEventType {
    const map: Partial<Record<TradeState, TradeEventType>> = {
        TP1_HIT: "TP1_HIT",
        TP2_HIT: "TP2_HIT",
        TP3_HIT: "TP3_HIT",
        BE_APPLIED: "BREAK_EVEN_APPLIED",
        PROFIT_LOCKED: "PROFIT_LOCK_APPLIED",
        RUNNER_ACTIVE: "RUNNER_ACTIVE",
        TRAILING: "TRAILING_UPDATED",
        CLOSED: "TRADE_CLOSED_PROFIT",
        STOPPED: "STOP_LOSS_HIT",
    };
    return map[state] || "TRADE_MODIFIED";
}

// ============================================
// EVENT MANAGEMENT
// ============================================

export async function createTradeEvent(
    uid: string,
    accountId: string,
    ticket: string,
    type: TradeEventType,
    state: TradeManagementState,
    metadata: Record<string, unknown> = {}
): Promise<string> {
    const eventRef = adminDatabase.ref(tradeEventsPath(uid, accountId, ticket)).push();
    const eventId = eventRef.key!;

    const event: TradeEvent = {
        eventId,
        userId: uid,
        accountId,
        tradeId: `${accountId}_${ticket}`,
        ticket,
        symbol: state.symbol,
        direction: state.direction,
        type,
        timestamp: Date.now(),
        price: state.currentPrice,
        title: getEventTitle(type, state),
        message: getEventMessage(type, state, metadata),
        severity: getEventSeverity(type),
        metadata: {
            entry: state.entry,
            sl: state.currentSl,
            tp: state.currentTp,
            volume: state.volume,
            ...metadata,
        },
        read: false,
        channel: "in_app",
        executed: false,
    };

    await eventRef.set(event);
    return eventId;
}

export async function getTradeEvents(
    uid: string,
    accountId: string,
    ticket: string
): Promise<TradeEvent[]> {
    const snap = await adminDatabase.ref(tradeEventsPath(uid, accountId, ticket)).get();
    if (!snap.exists()) return [];

    const events: TradeEvent[] = [];
    snap.forEach((child) => {
        events.push(child.val() as TradeEvent);
    });

    return events.sort((a, b) => b.timestamp - a.timestamp);
}

// ============================================
// EVENT TEMPLATES
// ============================================

function getEventTitle(type: TradeEventType, state: TradeManagementState): string {
    const sym = state.symbol;
    const dir = state.direction;

    switch (type) {
        case "TRADE_OPENED": return `📈 Trade Opened — ${sym} ${dir}`;
        case "TP1_APPROACHING": return `⚠️ ${sym} approaching TP1`;
        case "TP1_HIT": return `🎯 TP1 HIT — ${sym} ${dir}`;
        case "BREAK_EVEN_RECOMMENDED": return `💡 Break Even Recommended — ${sym} ${dir}`;
        case "BREAK_EVEN_APPLIED": return `🔒 Break Even Applied — ${sym} ${dir}`;
        case "TP2_APPROACHING": return `⚠️ ${sym} approaching TP2`;
        case "TP2_HIT": return `🎯 TP2 HIT — ${sym} ${dir}`;
        case "PROFIT_LOCK_RECOMMENDED": return `💡 Profit Lock Recommended — ${sym} ${dir}`;
        case "PROFIT_LOCK_APPLIED": return `🔒 Profit Locked — ${sym} ${dir}`;
        case "TP3_APPROACHING": return `⚠️ ${sym} approaching TP3`;
        case "TP3_HIT": return `🎯 TP3 HIT — ${sym} ${dir}`;
        case "RUNNER_ACTIVE": return `🏃 Runner Active — ${sym} ${dir}`;
        case "TRAILING_UPDATED": return `📏 Trailing Updated — ${sym} ${dir}`;
        case "TRADE_CLOSED_PROFIT": return `✅ Trade Closed (Profit) — ${sym} ${dir}`;
        case "TRADE_CLOSED_LOSS": return `❌ Trade Closed (Loss) — ${sym} ${dir}`;
        case "STOP_LOSS_HIT": return `🛑 Stop Loss Hit — ${sym} ${dir}`;
        case "TRADE_CANCELLED": return `🚫 Trade Cancelled — ${sym} ${dir}`;
        case "EXECUTION_FAILED": return `⚠️ Execution Failed — ${sym} ${dir}`;
        case "POSITION_RECONCILED": return `🔄 Position Reconciled — ${sym} ${dir}`;
        default: return `Trade Update — ${sym} ${dir}`;
    }
}

function getEventMessage(type: TradeEventType, state: TradeManagementState, metadata: Record<string, unknown>): string {
    const dir = state.direction;
    const entry = state.entry;
    const price = state.currentPrice;

    switch (type) {
        case "TP1_HIT":
            return `TP1 reached at ${formatPrice(price, state.symbol)}.\n\nSuggested action:\nMove SL to Break Even.\n\nEntry: ${formatPrice(entry, state.symbol)}\nCurrent: ${formatPrice(price, state.symbol)}\nTP2: ${formatPrice(state.config.tp2.price, state.symbol)}\nTP3: ${formatPrice(state.config.tp3.price, state.symbol)}\n\nRisk is now reduced.`;

        case "BREAK_EVEN_APPLIED":
            return `SL moved to ${formatPrice(state.currentSl, state.symbol)}.\n\nEntry: ${formatPrice(entry, state.symbol)}\nCurrent SL: ${formatPrice(state.currentSl, state.symbol)}\n\nTrade is now risk-free.`;

        case "TP2_HIT":
            return `TP2 reached at ${formatPrice(price, state.symbol)}.\n\nSuggested SL: ${formatPrice(state.config.tp1.price, state.symbol)}\nLocked profit: +${formatPoints(Math.abs(price - entry), state.symbol)}\n\nRemaining target:\nTP3 ${formatPrice(state.config.tp3.price, state.symbol)}`;

        case "PROFIT_LOCK_APPLIED":
            return `Profit locked at ${formatPrice(state.currentSl, state.symbol)}.\n\nLocked profit: +${formatPoints(Math.abs(state.currentSl - entry), state.symbol)}\n\nRemaining target:\nTP3 ${formatPrice(state.config.tp3.price, state.symbol)}\n\nRunner remains active.`;

        case "TP3_HIT":
            return `TP3 reached at ${formatPrice(price, state.symbol)}.\n\nAll targets achieved!\nRunner position remains active.`;

        case "RUNNER_ACTIVE":
            return `Runner position active.\n\nVolume: ${formatVolume(state.remainingVolume)}\nTrailing type: ${state.config.trailingType}`;

        case "STOP_LOSS_HIT":
            return `Stop loss hit at ${formatPrice(price, state.symbol)}.\n\nEntry: ${formatPrice(entry, state.symbol)}\nSL: ${formatPrice(state.currentSl, state.symbol)}`;

        case "TP1_APPROACHING":
        case "TP2_APPROACHING":
        case "TP3_APPROACHING": {
            const target = type.includes("TP1") ? state.config.tp1 : type.includes("TP2") ? state.config.tp2 : state.config.tp3;
            const dist = Math.abs(target.price - price);
            return `Current: ${formatPrice(price, state.symbol)}\nTarget: ${formatPrice(target.price, state.symbol)}\nDistance: ${formatPoints(dist, state.symbol)}`;
        }

        default:
            return `Trade updated at ${formatPrice(price, state.symbol)}`;
    }
}

function getEventSeverity(type: TradeEventType): TradeEventSeverity {
    const map: Partial<Record<TradeEventType, TradeEventSeverity>> = {
        TRADE_OPENED: "info",
        TP1_HIT: "success",
        TP2_HIT: "success",
        TP3_HIT: "success",
        BREAK_EVEN_APPLIED: "success",
        PROFIT_LOCK_APPLIED: "success",
        RUNNER_ACTIVE: "info",
        TRAILING_UPDATED: "info",
        TRADE_CLOSED_PROFIT: "success",
        TRADE_CLOSED_LOSS: "warning",
        STOP_LOSS_HIT: "error",
        TRADE_CANCELLED: "warning",
        EXECUTION_FAILED: "error",
        TP1_APPROACHING: "info",
        TP2_APPROACHING: "info",
        TP3_APPROACHING: "info",
        BREAK_EVEN_RECOMMENDED: "info",
        PROFIT_LOCK_RECOMMENDED: "info",
        POSITION_RECONCILED: "info",
        TRADE_MODIFIED: "info",
    };
    return map[type] || "info";
}

// ============================================
// AUDIT LOGGING
// ============================================

export async function logAudit(
    uid: string,
    accountId: string,
    ticket: string,
    action: AuditAction,
    data: {
        oldSL?: number;
        newSL?: number;
        oldTp?: number;
        newTp?: number;
        volume?: number;
        reason: string;
        mode: "AUTO" | "MANUAL";
        status: "SUCCESS" | "FAILED" | "SKIPPED";
        errorMessage?: string;
    }
): Promise<string> {
    const auditRef = adminDatabase.ref(auditLogPath(uid, accountId)).push();
    const auditId = auditRef.key!;

    const entry: AuditLogEntry = {
        auditId,
        userId: uid,
        accountId,
        ticket,
        action,
        ...data,
        timestamp: Date.now(),
        executionId: `${accountId}:${ticket}:${action}:${Date.now()}`,
    };

    await auditRef.set(entry);
    return auditId;
}

export async function getAuditLog(
    uid: string,
    accountId: string,
    limit = 50
): Promise<AuditLogEntry[]> {
    const snap = await adminDatabase.ref(auditLogPath(uid, accountId))
        .orderByChild("timestamp")
        .limitToLast(limit)
        .get();

    if (!snap.exists()) return [];

    const entries: AuditLogEntry[] = [];
    snap.forEach((child) => {
        entries.push(child.val() as AuditLogEntry);
    });

    return entries.reverse();
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

// ============================================
// RECOMMENDATION ENGINE
// ============================================

export function generateRecommendations(state: TradeManagementState): Recommendation[] {
    const recs: Recommendation[] = [];
    const price = state.currentPrice;
    const entry = state.entry;

    // TP1 approaching
    if (state.state === "OPEN" || state.state === "TP1_APPROACHING") {
        const dist = Math.abs(state.config.tp1.price - price);
        if (dist < state.config.tp1.price * 0.001) { // within 0.1%
            recs.push({
                id: `${state.ticket}_tp1_approach`,
                type: "approaching",
                priority: "medium",
                title: "TP1 is close",
                message: "Prepare to secure risk. TP1 is nearby.",
                tradeId: `${state.accountId}_${state.ticket}`,
                timestamp: Date.now(),
            });
        }
    }

    // BE recommendation after TP1
    if (state.state === "TP1_HIT" && state.config.breakEvenEnabled) {
        recs.push({
            id: `${state.ticket}_be_recommended`,
            type: "break_even",
            priority: "high",
            title: "Break Even Recommended",
            message: "TP1 reached. Move SL to break even to make this trade risk-free.",
            action: "Move SL to Entry",
            tradeId: `${state.accountId}_${state.ticket}`,
            timestamp: Date.now(),
        });
    }

    // Profit lock after TP2
    if (state.state === "TP2_HIT" && state.config.profitLockEnabled) {
        recs.push({
            id: `${state.ticket}_pl_recommended`,
            type: "profit_lock",
            priority: "high",
            title: "Profit Lock Recommended",
            message: `TP2 reached. Consider locking profit at ${formatPrice(state.config.tp1.price, state.symbol)}.`,
            action: "Lock Profit",
            tradeId: `${state.accountId}_${state.ticket}`,
            timestamp: Date.now(),
        });
    }

    // Trailing recommendation after TP3
    if (state.state === "TP3_HIT" && state.config.trailingEnabled) {
        recs.push({
            id: `${state.ticket}_trail_recommended`,
            type: "trailing",
            priority: "medium",
            title: "Runner Active",
            message: "TP3 reached. Runner position is active with trailing stop.",
            tradeId: `${state.accountId}_${state.ticket}`,
            timestamp: Date.now(),
        });
    }

    return recs;
}

// ============================================
// CREATE INITIAL TRADE STATE
// ============================================

export function createTradeState(
    uid: string,
    accountId: string,
    ticket: string,
    symbol: string,
    direction: TradeDirection,
    entry: number,
    sl: number,
    volume: number,
    config: TradeManagementConfig
): TradeManagementState {
    return {
        tradeId: `${accountId}_${ticket}`,
        userId: uid,
        accountId,
        ticket,
        symbol,
        direction,
        entry,
        currentSl: sl,
        currentTp: config.tp1.price,
        volume,
        currentPrice: entry,
        state: "OPEN",
        config,
        riskAmount: Math.abs(entry - sl) * volume * getContractSize(symbol),
        riskPoints: Math.abs(entry - sl),
        currentPnl: 0,
        currentR: 0,
        lockedProfit: 0,
        remainingVolume: volume,
        closeHistory: [],
        openedAt: Date.now(),
        lastUpdated: Date.now(),
        lastCheckedAt: Date.now(),
        executionCount: 0,
        manualOverride: false,
    };
}

function getContractSize(symbol: string): number {
    if (symbol.includes("XAU")) return 100;
    if (symbol.includes("BTC") || symbol.includes("ETH")) return 1;
    if (symbol.includes("US30") || symbol.includes("NAS")) return 1;
    return 100000;
}
