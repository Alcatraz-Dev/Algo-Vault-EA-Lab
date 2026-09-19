import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";

export type CopyConfigRec = {
    ownerUid: string;
    configId: string;
    masterId?: string;
    masterMt5Account?: string | number;
    followerMt5Account?: string | number;
    isActive?: boolean | string;
    lotMultiplier?: number | string;
    maxLot?: number | string;
    maxOpenTrades?: number | string;
    reverseSignals?: boolean;
    copyStopLoss?: boolean;
    copyTakeProfit?: boolean;
    totalCopied?: number | string;
    totalProfit?: number | string;
};

export type MirrorOrderShape = {
    ticket?: string | number;
    symbol?: string;
    type?: string;
    volume?: number;
    openPrice?: number;
    entryPrice?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
};

/**
 * Global copy trading switch. Managed at Admin → Settings → Copy Trading.
 */
export async function isCopyTradingEnabled(): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref("settings").once("value");
        const settings = snap.val() || {};
        return settings.copyTradingEnabled !== false;
    } catch {
        return true;
    }
}

// ─── Master eligibility ──────────────────────────────────────────────────────

export type MasterEligibility = {
    allowCopyTrading: boolean;
    allowBeCopied: boolean;
    allowBeFollowed: boolean;
    isFollowingDisabled: boolean;
    isBeingCopiedDisabled: boolean;
    canBeListed: boolean;
};

/**
 * Resolves the effective master eligibility for a given live account.
 *
 * Resolution order (most specific wins):
 *   1. Per-account override in `live_accounts/{id}/copyTradingOverride`
 *   2. Per-user override in `users/{uid}/copyTradingOverride`
 *   3. Per-account `allowCopyTrading` flag
 *   4. Global platform switch
 *
 * `allowBeCopied`  — the master has opted in to being mirrored (the EA owner).
 * `allowBeFollowed` — the master is listed in the marketplace discovery feed.
 * `isFollowingDisabled` — admin/user has blocked others from following.
 * `isBeingCopiedDisabled` — admin/user has blocked their account from being copied.
 */
export async function resolveMasterEligibility(
    accountId: string,
    ownerUid?: string | null
): Promise<MasterEligibility> {
    const base: MasterEligibility = {
        allowCopyTrading: true,
        allowBeCopied: true,
        allowBeFollowed: true,
        isFollowingDisabled: false,
        isBeingCopiedDisabled: false,
        canBeListed: true,
    };

    try {
        const globalSnap = await adminDatabase.ref("settings/copyTradingEnabled").once("value");
        const globalEnabled = globalSnap.val() !== false;

        if (!globalEnabled) {
            return {
                allowCopyTrading: false,
                allowBeCopied: false,
                allowBeFollowed: false,
                isFollowingDisabled: true,
                isBeingCopiedDisabled: true,
                canBeListed: false,
            };
        }

        // 1. Per-account override
        const acctSnap = await adminDatabase.ref(`live_accounts/${accountId}`).once("value");
        const acct = acctSnap.val() || {};
        const acctOverride = acct.copyTradingOverride as Partial<MasterEligibility> | undefined;

        if (acctOverride) {
            if (acctOverride.allowBeCopied === false) base.allowBeCopied = false;
            if (acctOverride.allowBeFollowed === false) base.allowBeFollowed = false;
            if (acctOverride.isFollowingDisabled === true) base.isFollowingDisabled = true;
            if (acctOverride.isBeingCopiedDisabled === true) base.isBeingCopiedDisabled = true;
            if (acctOverride.canBeListed === false) base.canBeListed = false;
        }

        // 2. Per-user override
        if (ownerUid) {
            const userSnap = await adminDatabase.ref(`users/${ownerUid}`).once("value");
            const user = userSnap.val() || {};
            const userOverride = user.copyTradingOverride as Partial<MasterEligibility> | undefined;

            if (userOverride) {
                if (userOverride.allowBeCopied === false) base.allowBeCopied = false;
                if (userOverride.allowBeFollowed === false) base.allowBeFollowed = false;
                if (userOverride.isFollowingDisabled === true) base.isFollowingDisabled = true;
                if (userOverride.isBeingCopiedDisabled === true) base.isBeingCopiedDisabled = true;
                if (userOverride.canBeListed === false) base.canBeListed = false;
            }
        }

        // 3. Per-account flag. Masters must explicitly opt in.
        if (acct.allowCopyTrading !== true) {
            base.allowBeCopied = false;
            base.allowBeFollowed = false;
            base.isBeingCopiedDisabled = true;
            base.canBeListed = false;
        }

        base.allowCopyTrading = globalEnabled && base.allowBeCopied && !base.isBeingCopiedDisabled;
        return base;
    } catch (error) {
        console.error("[resolveMasterEligibility]", error);
        return base;
    }
}

/**
 * Sets the master opt-in toggle for a live account.
 * Called when the master flips their "Allow Copy Trading" switch.
 */
export async function setMasterAllowCopyTrading(
    accountId: string,
    allow: boolean
): Promise<void> {
    await adminDatabase.ref(`live_accounts/${accountId}/allowCopyTrading`).set(Boolean(allow));
}

/**
 * Sets a per-user opt-out of being copied (prevents any master config from
 * targeting this user's MT5 accounts as followers).
 */
export async function setUserBeingCopiedDisabled(
    uid: string,
    disabled: boolean
): Promise<void> {
    await adminDatabase.ref(`users/${uid}/copyTradingOverride/isBeingCopiedDisabled`).set(Boolean(disabled));
}

/**
 * Sets a per-user opt-out of following (prevents this user from creating new
 * copy configs). Existing configs remain but can be toggled off individually.
 */
export async function setUserFollowingDisabled(
    uid: string,
    disabled: boolean
): Promise<void> {
    await adminDatabase.ref(`users/${uid}/copyTradingOverride/isFollowingDisabled`).set(Boolean(disabled));
}

/**
 * Admin override: block a specific user from being followed or from following.
 */
export async function setAdminUserOverride(params: {
    uid: string;
    isFollowingDisabled?: boolean;
    isBeingCopiedDisabled?: boolean;
}): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (params.isFollowingDisabled !== undefined) {
        updates["copyTradingOverride/isFollowingDisabled"] = Boolean(params.isFollowingDisabled);
    }
    if (params.isBeingCopiedDisabled !== undefined) {
        updates["copyTradingOverride/isBeingCopiedDisabled"] = Boolean(params.isBeingCopiedDisabled);
    }
    if (Object.keys(updates).length === 0) return;
    await adminDatabase.ref(`users/${params.uid}`).update(updates);
}

/**
 * Admin override on a specific live account.
 */
export async function setAdminAccountOverride(params: {
    accountId: string;
    allowBeCopied?: boolean;
    allowBeFollowed?: boolean;
    isFollowingDisabled?: boolean;
    isBeingCopiedDisabled?: boolean;
    canBeListed?: boolean;
}): Promise<void> {
    const updates: Record<string, unknown> = {};
    const keys: (keyof typeof params)[] = [
        "allowBeCopied",
        "allowBeFollowed",
        "isFollowingDisabled",
        "isBeingCopiedDisabled",
        "canBeListed",
    ];
    for (const key of keys) {
        const value = params[key];
        if (value !== undefined) {
            updates[`copyTradingOverride/${key}`] = Boolean(value);
        }
    }
    if (Object.keys(updates).length === 0) return;
    await adminDatabase.ref(`live_accounts/${params.accountId}`).update(updates);
}

/**
 * Collects every active copy config whose master matches the given account.
 *
 * A config matches when either its live-account key (`masterId`) or its raw
 * MT5 account number (`masterMt5Account`) equals the incoming values.
 *
 * When `respectEligibility` is true (default), configs whose master account
 * has been opted-out or admin-disabled are skipped.
 */
export async function collectMatchingConfigs(
    masterId: string,
    masterMt5Account: string | number,
    options?: { respectEligibility?: boolean }
): Promise<CopyConfigRec[]> {
    const snap = await adminDatabase.ref("copy_trading").get();
    const data = snap.val() || {};
    const list: CopyConfigRec[] = [];

    const respect = options?.respectEligibility !== false;
    let eligibility: MasterEligibility | null = null;

    for (const ownerUid of Object.keys(data)) {
        const userConfigs = data[ownerUid] || {};
        for (const configId of Object.keys(userConfigs)) {
            const cfg = userConfigs[configId];
            if (!cfg) continue;

            const matchesMaster =
                (cfg.masterId && String(cfg.masterId) === String(masterId)) ||
                (cfg.masterMt5Account != null &&
                    String(cfg.masterMt5Account) === String(masterMt5Account));

            if (!matchesMaster) continue;
            if (cfg.isActive !== false && cfg.isActive !== "false") {
                if (respect) {
                    if (!eligibility) {
                        // Resolve once for the whole batch
                        const acctSnap = await adminDatabase.ref(`live_accounts/${masterId}`).once("value");
                        const ownerUidOfMaster = (acctSnap.val() || {}).ownerUid as string | undefined;
                        eligibility = await resolveMasterEligibility(masterId, ownerUidOfMaster ?? null);
                    }
                    if (!eligibility.allowBeCopied || eligibility.isBeingCopiedDisabled) continue;
                }
                list.push({ ownerUid, configId, ...cfg });
            }
        }
    }

    return list;
}

function parseNum(value: unknown, fallback = 0): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

/**
 * Mirrors a single master order out to every matching follower config.
 *
 * Applies dedupe, the follower's max-open-trades limit, lot multiplier /
 * cap, reverse-signal flipping, and SL/TP copying before writing:
 *  - mt5_orders/{follower}/{newTicket}   (the EA picks this up)
 *  - copied_trades/{owner}/{newTicket}   (account-side ledger)
 *  - copy_trading/{owner}/{configId}/totalCopied
 *
 * Returns the orders that were actually copied (empty when the feature is
 * off or no config matched).
 */
export async function mirrorMasterOrder(params: {
    masterId: string;
    masterMt5Account: string | number;
    order: MirrorOrderShape;
    configs?: CopyConfigRec[];
    notify?: boolean;
}): Promise<Record<string, unknown>[]> {
    if (!(await isCopyTradingEnabled())) return [];

    const configs = params.configs ?? (await collectMatchingConfigs(params.masterId, params.masterMt5Account));
    const order = params.order;
    const copied: Record<string, unknown>[] = [];

    for (const cfg of configs) {
        const follower = String(cfg.followerMt5Account ?? "").trim();
        if (!follower) continue;

        const existingOrders = (await adminDatabase.ref(`mt5_orders/${follower}`).get()).val() || {};

        let alreadyMirrored = false;
        for (const ticket of Object.keys(existingOrders)) {
            const entry = existingOrders[ticket];
            if (
                entry &&
                String(entry.masterTicket ?? "") === String(order.ticket) &&
                entry.source === "copy_follower"
            ) {
                alreadyMirrored = true;
                break;
            }
        }
        if (alreadyMirrored) continue;

        // Follower's max open trades limit
        const maxOpenTrades = parseNum(cfg.maxOpenTrades);
        if (maxOpenTrades > 0) {
            const copiedSnap = (await adminDatabase.ref(`copied_trades/${cfg.ownerUid}`).get()).val() || {};
            let openForConfig = 0;
            for (const key of Object.keys(copiedSnap)) {
                const rec = copiedSnap[key];
                if (
                    rec &&
                    rec.status === "open" &&
                    String(rec.copyConfigId ?? "") === String(cfg.configId)
                ) {
                    openForConfig += 1;
                }
            }
            if (openForConfig >= maxOpenTrades) continue;
        }

        // Lot sizing
        const multiplier = parseNum(cfg.lotMultiplier) > 0 ? parseNum(cfg.lotMultiplier) : 1;
        let volume = parseNum(order.volume, 0.01) * multiplier;
        const maxLot = parseNum(cfg.maxLot);
        if (maxLot > 0) volume = Math.min(volume, maxLot);
        volume = Math.max(0.01, Math.round(volume * 100) / 100);

        // Signal reversal
        const rawType = String(order.type ?? "BUY").toUpperCase();
        const type: string = cfg.reverseSignals
            ? rawType === "BUY"
                ? "SELL"
                : "BUY"
            : rawType;

        const newTicket = String(Math.floor(10000000 + Math.random() * 90000000));
        const copyNow = Date.now();

        const mirrored: Record<string, unknown> = {
            ticket: newTicket,
            masterTicket: order.ticket,
            symbol: order.symbol,
            type,
            volume,
            openPrice: parseNum(order.openPrice ?? order.entryPrice, 0),
            stopLoss: cfg.copyStopLoss === false ? null : order.stopLoss ?? null,
            takeProfit: cfg.copyTakeProfit === false ? null : order.takeProfit ?? null,
            source: "copy_follower",
            copyConfigId: cfg.configId,
            masterMt5Account: String(params.masterMt5Account),
            followerMt5Account: follower,
            status: "PENDING_MT5_EXECUTION",
            createdAt: copyNow,
            updatedAt: copyNow,
        };

        await adminDatabase.ref(`mt5_orders/${follower}/${newTicket}`).set(mirrored);

        // Bridge to the trading gateway so the AlgoVaultTradeGateway EA
        // can pick up and execute the copied order via /api/trading/gateway/commands.
        await adminDatabase
            .ref(`trading_order_requests/${cfg.ownerUid}/${newTicket}`)
            .set({
                id: newTicket,
                clientOrderId: newTicket,
                accountId: `gateway_${follower}`,
                action: type,
                symbol: order.symbol,
                volume,
                price: parseNum(order.openPrice ?? order.entryPrice, 0),
                sl: cfg.copyStopLoss === false ? null : order.stopLoss ?? 0,
                tp: cfg.copyTakeProfit === false ? null : order.takeProfit ?? 0,
                source: "copy_follower",
                copyConfigId: cfg.configId,
                masterTicket: order.ticket,
                masterMt5Account: String(params.masterMt5Account),
                followerMt5Account: follower,
                status: "queued",
                createdAt: copyNow,
                updatedAt: copyNow,
            });

        await adminDatabase.ref(`copied_trades/${cfg.ownerUid}/${newTicket}`).set({
            ticket: newTicket,
            masterTicket: order.ticket,
            symbol: order.symbol,
            type,
            volume,
            openPrice: mirrored.openPrice,
            currentProfit: 0,
            openedAt: copyNow,
            status: "open",
            copyConfigId: cfg.configId,
            masterMt5Account: String(params.masterMt5Account),
        });

        await adminDatabase
            .ref(`copy_trading/${cfg.ownerUid}/${cfg.configId}`)
            .update({
                totalCopied: parseNum(cfg.totalCopied) + 1,
                updatedAt: copyNow,
            });

        if (params.notify !== false && cfg.ownerUid) {
            void notifyUser(cfg.ownerUid, {
                title: "Copy Signal Mirrored",
                message: `${order.symbol} ${type} · ${volume} lots copied to follower account #${follower}.`,
                level: "info",
                link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/copy-trading`,
            });
        }

        copied.push(mirrored);
    }

    return copied;
}

/**
 * When a master trade closes, queue close orders for every open copied
 * follower position tied to that master ticket.
 */
export async function mirrorMasterClose(params: {
    masterId: string;
    masterMt5Account: string | number;
    masterTicket: string | number;
    closePrice?: number | null;
    notify?: boolean;
}): Promise<number> {
    if (!(await isCopyTradingEnabled())) return 0;

    const configs = await collectMatchingConfigs(params.masterId, params.masterMt5Account);
    if (configs.length === 0) return 0;

    let queued = 0;
    const now = Date.now();

    for (const cfg of configs) {
        const copiedSnap = (await adminDatabase.ref(`copied_trades/${cfg.ownerUid}`).get()).val() || {};

        for (const ticket of Object.keys(copiedSnap)) {
            const trade = copiedSnap[ticket];
            if (
                !trade ||
                trade.status !== "open" ||
                String(trade.masterTicket ?? "") !== String(params.masterTicket) ||
                String(trade.copyConfigId ?? "") !== String(cfg.configId)
            ) {
                continue;
            }

            const follower = String(cfg.followerMt5Account ?? "").trim();
            if (!follower) continue;

            const followerOrders = (await adminDatabase.ref(`mt5_orders/${follower}`).get()).val() || {};
            let alreadyQueued = false;
            for (const key of Object.keys(followerOrders)) {
                const entry = followerOrders[key];
                if (
                    entry &&
                    String(entry.action ?? "").toUpperCase() === "CLOSE" &&
                    String(entry.masterTicket ?? "") === String(params.masterTicket) &&
                    String(entry.copyConfigId ?? "") === String(cfg.configId)
                ) {
                    alreadyQueued = true;
                    break;
                }
            }
            if (alreadyQueued) continue;

            const closeTicket = String(Math.floor(10000000 + Math.random() * 90000000));
            const closeOrder: Record<string, unknown> = {
                ticket: closeTicket,
                action: "CLOSE",
                masterTicket: params.masterTicket,
                targetTicket: trade.mt5Ticket || ticket,
                symbol: trade.symbol,
                type: trade.type,
                volume: trade.volume,
                closePrice: params.closePrice ?? null,
                source: "copy_follower",
                copyConfigId: cfg.configId,
                masterMt5Account: String(params.masterMt5Account),
                followerMt5Account: follower,
                status: "PENDING_MT5_EXECUTION",
                createdAt: now,
                updatedAt: now,
            };

            await adminDatabase.ref(`mt5_orders/${follower}/${closeTicket}`).set(closeOrder);

            // Bridge to trading gateway so the EA can execute the close.
            await adminDatabase
                .ref(`trading_order_requests/${cfg.ownerUid}/${closeTicket}`)
                .set({
                    id: closeTicket,
                    clientOrderId: closeTicket,
                    accountId: `gateway_${follower}`,
                    action: "CLOSE",
                    symbol: trade.symbol,
                    volume: trade.volume,
                    ticket: trade.mt5Ticket || 0,
                    source: "copy_follower",
                    copyConfigId: cfg.configId,
                    masterTicket: params.masterTicket,
                    masterMt5Account: String(params.masterMt5Account),
                    followerMt5Account: follower,
                    status: "queued",
                    createdAt: now,
                    updatedAt: now,
                });

            queued += 1;

            if (params.notify !== false && cfg.ownerUid) {
                void notifyUser(cfg.ownerUid, {
                    title: "Copy Close Signal",
                    message: `${trade.symbol} close queued for follower #${follower} (master #${params.masterTicket} closed).`,
                    level: "warning",
                    link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/account/copy-trading`,
                });
            }
        }
    }

    return queued;
}

/**
 * Locates the copy config a follower order belongs to.
 */
async function findConfigByFollower(
    followerMt5Account: string | number,
    configId?: string
): Promise<{ ownerUid: string; configId: string; cfg: CopyConfigRec } | null> {
    const snap = await adminDatabase.ref("copy_trading").get();
    const data = snap.val() || {};

    for (const ownerUid of Object.keys(data)) {
        const userConfigs = data[ownerUid] || {};
        for (const cid of Object.keys(userConfigs)) {
            const cfg = userConfigs[cid];
            if (!cfg) continue;
            const sameAccount = String(cfg.followerMt5Account ?? "") === String(followerMt5Account);
            const sameConfig = !configId || String(cfg.configId ?? cid) === String(configId);
            if (sameAccount && sameConfig) {
                return { ownerUid, configId: cid, cfg: { ownerUid, configId: cid, ...cfg } };
            }
        }
    }

    return null;
}

/**
 * Returns true when `mt5_orders/{mt5Account}` holds a copy-follower entry
 * matching the given position ticket (either the ledger ticket key or the
 * real MT5 ticket). Used to stop copy-of-copy recursion when a gateway
 * account that is itself being copied also acts as a master.
 */
export async function isCopiedLedgerPosition(
    mt5Account: string | number,
    ticket: string | number
): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`mt5_orders/${mt5Account}`).get();
        const orders = snap.val() || {};
        for (const key of Object.keys(orders)) {
            const entry = orders[key];
            if (!entry || String(entry.source ?? "") !== "copy_follower") continue;
            if (
                String(key) === String(ticket) ||
                String(entry.mt5Ticket ?? "") === String(ticket)
            ) {
                return true;
            }
        }
    } catch {
        /* ignore */
    }
    return false;
}

/**
 * Records a master's realized P/L (from a closed position) into
 * `live_accounts/{accountId}/stats` so marketplace cards can show win rate,
 * total profit/loss, and profit factor for gateway accounts.
 */
export async function recordMasterPerformance(params: {
    accountId: string;
    realizedProfit: number;
    closedAt: number;
}): Promise<void> {
    try {
        const ref = adminDatabase.ref(`live_accounts/${params.accountId}`);
        const snap = await ref.get();
        const acct = snap.val() || {};
        const prev = (acct.stats || {}) as Record<string, unknown>;

        const totalTrades = parseNum(prev.totalTrades) + 1;
        const winningTrades = parseNum(prev.winningTrades) + (params.realizedProfit > 0 ? 1 : 0);
        const grossProfit = parseNum(prev.grossProfit) + Math.max(0, params.realizedProfit);
        const grossLoss = parseNum(prev.grossLoss) + Math.max(0, -params.realizedProfit);
        const totalProfit = parseNum(prev.totalProfit) + params.realizedProfit;

        await ref.update({
            stats: {
                winRate: totalTrades > 0 ? Math.round((winningTrades / totalTrades) * 1000) / 10 : 0,
                totalProfit: Math.round(totalProfit * 100) / 100,
                totalTrades,
                winningTrades,
                losingTrades: totalTrades - winningTrades,
                grossProfit: Math.round(grossProfit * 100) / 100,
                grossLoss: Math.round(grossLoss * 100) / 100,
                profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : (grossProfit > 0 ? grossProfit : 0),
                drawdown: Math.round(parseNum(acct.drawdown) * 100) / 100,
            },
            updatedAt: params.closedAt,
        });
    } catch (error) {
        console.error("[recordMasterPerformance]", error);
    }
}

/**
 * Records the real MT5 ticket on a copied trade once the follower EA
 * acknowledges execution (order ack carries mt5Ticket).
 */
export async function attachCopiedMt5Ticket(params: {
    mt5Account: string | number;
    ticket: string | number;
    mt5Ticket: string | number;
}): Promise<void> {
    const ordersSnap = await adminDatabase.ref(`mt5_orders/${params.mt5Account}`).get();
    const orders = ordersSnap.val() || {};
    const rec = orders[String(params.ticket)];
    if (!rec || rec.source !== "copy_follower" || !rec.copyConfigId) return;

    const found = await findConfigByFollower(params.mt5Account, String(rec.copyConfigId));
    if (!found) return;

    await adminDatabase
        .ref(`copied_trades/${found.ownerUid}/${String(params.ticket)}`)
        .update({ mt5Ticket: String(params.mt5Ticket), updatedAt: Date.now() });
}

/**
 * Settles a copied trade when the follower EA reports it closing through the
 * trade endpoint. Matches on either the platfrom ticket or the real MT5
 * ticket, marks the copied_trades ledger entry closed with realized P/L,
 * and updates the config's running totalProfit.
 */
export async function reconcileCopiedClose(params: {
    accountId: string;
    mt5Account: string | number;
    ticket: string | number;
    closePrice?: number | null;
    profit: number;
    closedAt: number;
}): Promise<void> {
    const ordersSnap = await adminDatabase.ref(`mt5_orders/${params.mt5Account}`).get();
    const orders = ordersSnap.val() || {};

    let foundKey = "";
    let rec: { source?: string; copyConfigId?: string; masterTicket?: string | number } | null = null;
    for (const key of Object.keys(orders)) {
        const entry = orders[key];
        const matchesTicket =
            String(key) === String(params.ticket) ||
            String(entry?.mt5Ticket ?? "") === String(params.ticket);
        if (entry && matchesTicket) {
            foundKey = key;
            rec = entry;
            break;
        }
    }

    if (!rec || rec.source !== "copy_follower" || !foundKey) return;

    const found = await findConfigByFollower(params.mt5Account, String(rec.copyConfigId ?? ""));
    if (!found) return;

    const copiedRef = adminDatabase.ref(`copied_trades/${found.ownerUid}/${foundKey}`);
    const existing = (await copiedRef.get()).val() || {};

    if (existing?.status === "closed") return;

    await copiedRef.update({
        status: "closed",
        closePrice: params.closePrice ?? existing.closePrice ?? null,
        closedAt: params.closedAt,
        profit: params.profit,
        currentProfit: params.profit,
        updatedAt: params.closedAt,
    });

    await adminDatabase
        .ref(`copy_trading/${found.ownerUid}/${found.configId}`)
        .update({
            totalProfit: parseNum(found.cfg.totalProfit) + params.profit,
            updatedAt: params.closedAt,
        });

    void notifyUser(found.ownerUid, {
        title: "Copied Trade Closed",
        message: `${existing.symbol || "Trade"} closed · P/L: ${params.profit >= 0 ? "+" : ""}$${params.profit.toFixed(2)}`,
        level: params.profit >= 0 ? "success" : "error",
        link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/account/copy-trading`,
    });
}

// ─── Marketplace discovery ───────────────────────────────────────────────────

export type MarketplaceMaster = {
    id: string;
    ownerUid?: string | null;
    productId?: string;
    productName?: string;
    mt5Account?: string | number;
    broker?: string | null;
    server?: string | null;
    balance?: number | null;
    equity?: number | null;
    floatingProfit?: number | null;
    online?: boolean;
    lastHeartbeatAt?: number | null;
    stats?: {
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        totalProfit?: number;
        drawdown?: number;
    };
    eligibility?: MasterEligibility;
    followerCount?: number;
    totalCopiedProfit?: number;
};

/**
 * Builds the marketplace discovery feed of masters eligible to be copied.
 *
 * Filters out accounts that are offline, opted-out, admin-blocked, or
 * explicitly hidden from the marketplace. Aggregates follower counts and
 * running P/L per master.
 */
export async function listMarketplaceMasters(options?: {
    search?: string;
    broker?: string;
    minFollowers?: number;
    onlyOnline?: boolean;
    limit?: number;
}): Promise<MarketplaceMaster[]> {
    try {
        const enabled = await isCopyTradingEnabled();
        if (!enabled) return [];

        const accountsSnap = await adminDatabase.ref("live_accounts").get();
        const accounts = accountsSnap.val() || {};
        const configsSnap = await adminDatabase.ref("copy_trading").get();
        const allConfigs = configsSnap.val() || {};

        // Aggregate follower counts + profit per master
        const followerCount: Record<string, number> = {};
        const profitByMaster: Record<string, number> = {};
        for (const ownerUid of Object.keys(allConfigs)) {
            const userConfigs = allConfigs[ownerUid] || {};
            for (const configId of Object.keys(userConfigs)) {
                const cfg = userConfigs[configId];
                if (!cfg) continue;
                const masterKey = String(cfg.masterId ?? cfg.masterMt5Account ?? "");
                if (!masterKey) continue;
                followerCount[masterKey] = (followerCount[masterKey] || 0) + 1;
                profitByMaster[masterKey] = parseNum(profitByMaster[masterKey]) + parseNum(cfg.totalProfit);
            }
        }

        const results: MarketplaceMaster[] = [];
        const search = (options?.search || "").trim().toLowerCase();
        const brokerFilter = (options?.broker || "").trim().toLowerCase();
        const minFollowers = options?.minFollowers ?? 0;
        const onlyOnline = options?.onlyOnline !== false;
        const limit = options?.limit ?? 50;

        for (const [accountId, raw] of Object.entries(accounts)) {
            const acct = (raw as Record<string, unknown>) || {};
            if (!acct) continue;

            const online = Boolean(
                acct.lastHeartbeatAt &&
                    Date.now() - Number(acct.lastHeartbeatAt) < 60_000
            );

            if (onlyOnline && !online) continue;

            const eligibility = await resolveMasterEligibility(
                accountId,
                (acct.ownerUid as string | undefined) ?? null
            );

            if (!eligibility.allowBeCopied || eligibility.isBeingCopiedDisabled) continue;
            if (!eligibility.allowBeFollowed) continue;
            if (!eligibility.canBeListed) continue;

            const productName = String(acct.productName || "");
            const broker = String(acct.broker || "");
            const server = String(acct.server || "");

            if (search) {
                const hay = `${productName} ${broker} ${server} ${acct.mt5Account}`.toLowerCase();
                if (!hay.includes(search)) continue;
            }
            if (brokerFilter && broker.toLowerCase() !== brokerFilter) continue;

            const masterKey = accountId;
            const followers = followerCount[masterKey] || 0;
            if (followers < minFollowers) continue;

            results.push({
                id: accountId,
                ownerUid: (acct.ownerUid as string | undefined) ?? null,
                productId: (acct.productId as string | undefined),
                productName: productName || undefined,
                mt5Account: acct.mt5Account as string | number | undefined,
                broker: broker || null,
                server: server || null,
                balance: parseNum(acct.balance),
                equity: parseNum(acct.equity),
                floatingProfit: parseNum(acct.floatingProfit),
                online,
                lastHeartbeatAt: (acct.lastHeartbeatAt as number | undefined) ?? null,
                stats: (acct.stats as MarketplaceMaster["stats"]) ?? undefined,
                eligibility,
                followerCount: followers,
                totalCopiedProfit: profitByMaster[masterKey] || 0,
            });

            if (results.length >= limit) break;
        }

        // Sort: online first, then by follower count desc
        results.sort((a, b) => {
            if (a.online !== b.online) return (a.online ? 1 : 0) - (b.online ? 1 : 0);
            return (b.followerCount || 0) - (a.followerCount || 0);
        });

        return results;
    } catch (error) {
        console.error("[listMarketplaceMasters]", error);
        return [];
    }
}

/**
 * Counts active copy-trading connections for admin monitoring.
 */
export async function countActiveConnections(): Promise<{
    total: number;
    active: number;
    paused: number;
    byMaster: Record<string, number>;
}> {
    const snap = await adminDatabase.ref("copy_trading").get();
    const data = snap.val() || {};
    let total = 0;
    let active = 0;
    let paused = 0;
    const byMaster: Record<string, number> = {};

    for (const ownerUid of Object.keys(data)) {
        const userConfigs = data[ownerUid] || {};
        for (const configId of Object.keys(userConfigs)) {
            const cfg = userConfigs[configId];
            if (!cfg) continue;
            total++;
            const isActive = cfg.isActive !== false && cfg.isActive !== "false";
            if (isActive) active++; else paused++;
            const masterKey = String(cfg.masterId ?? cfg.masterMt5Account ?? "unknown");
            byMaster[masterKey] = (byMaster[masterKey] || 0) + 1;
        }
    }

    return { total, active, paused, byMaster };
}
