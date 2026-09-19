import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";

/**
 * Unified bot registry for the AlgoVault MT5 Gateway.
 *
 * Every monitored Expert Advisor — Marketplace products and user-owned
 * Custom/Legacy EAs — is represented as one "bot record" under
 * `user_bots/{botId}`. Both types flow through the same pipeline:
 *
 *   MT5 EX5 → MT5 Gateway → bot identification (magic/account/symbol/comment)
 *             → license/entitlement → AlgoVault API → RTDB
 *             → Live Performance / Statistics / Alerts / AI
 *
 * NOTE: `bots/{productId}` is the MARKETPLACE PRODUCT CATALOG (used by the
 * admin bot editor and the buy flow). User-facing bot records live in the
 * separate `user_bots/` tree so the two never collide.
 */

export type BotType = "marketplace" | "custom";
export type BotStatus = "active" | "paused" | "disconnected";

export type BotMapping = {
    mt5Account?: string | null;
    magicNumber?: string | null;
    symbol?: string | null;
    comment?: string | null;
    updatedAt?: number;
};

export type UserBot = {
    id: string;
    ownerId: string;
    type: BotType;
    name: string;
    platform: string;
    symbol: string | null;
    timeframe: string | null;
    magicNumber: string | null;
    commentFilter: string | null;
    productId: string | null;
    licenseId: string | null;
    mt5Account: string | null;
    gatewayInstallationId: string | null;
    mapping: BotMapping | null;
    status: BotStatus;
    online: boolean;
    lastHeartbeatAt: number | null;
    description?: string;
    createdAt: number;
    updatedAt: number;
};

export const BOT_ID_PREFIX = "BOT";

/** Uppercased, alphanumeric prefix derived from a product slug, e.g. BOT-GOLD. */
export function botPrefixFromProduct(productId: string): string {
    const slug = String(productId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const core = slug.slice(0, 6) || "EA";
    return `${BOT_ID_PREFIX}-${core}`;
}

export function generateCustomBotId(): string {
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${BOT_ID_PREFIX}-CUSTOM-${suffix}`;
}

export function generateMarketplaceBotId(userId: string, productId: string): string {
    const seed = `${userId}:${productId}`.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const suffix = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 6).toUpperCase();
    return `${botPrefixFromProduct(productId)}-${suffix}`;
}

export async function getBot(userId: string, botId: string): Promise<UserBot | null> {
    const snap = await adminDatabase.ref(`user_bots/${botId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    const bot = val as UserBot;
    if (String(bot.ownerId || "") !== userId) return null;
    return bot;
}

export async function listUserBots(userId: string): Promise<UserBot[]> {
    // No orderByChild on /user_bots: that would require an `.indexOn: ownerId`
    // rule that isn't deployed. We maintain a per-owner lookup node instead and
    // fall back to a one-time scan to backfill bots created before the index.
    const indexSnap = await adminDatabase.ref(`user_bots_index/${userId}`).get();
    const indexVal = (indexSnap.val() || {}) as Record<string, unknown>;
    const ids = Object.keys(indexVal);

    const readBot = async (id: string): Promise<UserBot | null> => {
        const snap = await adminDatabase.ref(`user_bots/${id}`).get();
        const raw = snap.val();
        if (!raw || typeof raw !== "object") return null;
        return { ...(raw as UserBot), id };
    };

    let bots: UserBot[] = [];
    if (ids.length > 0) {
        const entries = await Promise.all(ids.map(readBot));
        bots = entries.filter((b): b is UserBot => b !== null);
    } else {
        const allSnap = await adminDatabase.ref("user_bots").get();
        const all = (allSnap.val() || {}) as Record<string, unknown>;
        const updates: Record<string, boolean> = {};
        for (const [id, raw] of Object.entries(all)) {
            if (!raw || typeof raw !== "object") continue;
            const botRaw = raw as UserBot;
            if (String(botRaw.ownerId || "") !== userId) continue;
            bots.push({ ...botRaw, id });
            updates[id] = true;
        }
        if (Object.keys(updates).length > 0) {
            await adminDatabase.ref(`user_bots_index/${userId}`).update(updates);
        }
    }

    return bots
        .filter((b) => String(b.ownerId || "") === userId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function isProductOwner(userId: string, productId: string): Promise<boolean> {
    const snap = await adminDatabase.ref(`users/${userId}`).get();
    const user = snap.val();
    return Boolean(user && (user.role === "admin" || user.docId === productId));
}

/**
 * Creates or reuses a unique bot record, with idempotency: for Marketplace
 * bots the mapping (product + account + magic) yields a deterministic ID so
 * re-running connect never duplicates the record.
 */
export async function upsertBot(record: Omit<UserBot, "createdAt" | "updatedAt"> & { id: string }): Promise<UserBot> {
    const now = Date.now();
    const ref = adminDatabase.ref(`user_bots/${record.id}`);
    const existing = (await ref.get()).val() as Partial<UserBot> | null;
    const next: UserBot = {
        ...record,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        online: existing?.online ?? false,
        lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
        mapping: record.mapping || existing?.mapping || null,
    };
    await ref.set(next);
    await adminDatabase.ref(`user_bots_index/${record.ownerId}/${record.id}`).set(true);
    return next;
}

/**
 * Custom-bot entitlement lives in the SAME license tree as Marketplace
 * licenses (`licenses/{uid}/{licenseId}`), tagged `type: "custom_bot"` and
 * linked back to the bot. Validity is tied to an active Pro/Enterprise
 * subscription PLUS an active custom-bot entitlement record, so a user cannot
 * monitor arbitrary accounts with a stale or foreign entitlement.
 */
export type CustomBotLicense = {
    id: string;
    type: "custom_bot";
    status: "active" | "revoked" | "expired";
    userId: string;
    botId: string;
    licenseKey: string;
    productId: string | null;
    mt5Account: string | null;
    gatewayInstallationId: string | null;
    expiresAt: number;
    startedAt: number;
    createdAt: number;
    updatedAt: number;
};

export async function createCustomBotEntitlement(userId: string, botId: string, mt5Account?: string): Promise<CustomBotLicense> {
    const id = `${botId}-LIC`;
    const now = Date.now();
    const record: CustomBotLicense = {
        id,
        type: "custom_bot",
        status: "active",
        userId,
        botId,
        licenseKey: crypto.randomBytes(12).toString("hex").toUpperCase(),
        productId: null,
        mt5Account: mt5Account || null,
        gatewayInstallationId: null,
        expiresAt: 0,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
    };
    await adminDatabase.ref(`licenses/${userId}/${id}`).set(record);
    return record;
}

export type CustomEntitlementCheck = {
    valid: boolean;
    reason?: "not_found" | "inactive" | "expired" | "not_pro";
};

async function hasProSubscription(userId: string): Promise<boolean> {
    const snap = await adminDatabase.ref(`users/${userId}/subscription`).get();
    const sub = snap.val();
    if (!sub || typeof sub !== "object") return false;
    const s = sub as { plan?: string; status?: string };
    const active = s.status === "active" || s.status === "active";
    const pro = s.plan === "pro" || s.plan === "enterprise";
    return active && pro;
}

export async function validateCustomEntitlement(userId: string, botId: string): Promise<CustomEntitlementCheck> {
    const id = `${botId}-LIC`;
    const snap = await adminDatabase.ref(`licenses/${userId}/${id}`).get();
    const lic = snap.val();
    if (!lic || typeof lic !== "object") return { valid: false, reason: "not_found" };
    const l = lic as CustomBotLicense;
    if (l.type !== "custom_bot" || l.botId !== botId) return { valid: false, reason: "not_found" };
    if (l.status !== "active") return { valid: false, reason: "inactive" };
    if (l.expiresAt > 0 && Date.now() >= l.expiresAt) return { valid: false, reason: "expired" };
    if (l.userId !== userId) return { valid: false, reason: "not_found" };

    if (!(await hasProSubscription(userId))) return { valid: false, reason: "not_pro" };
    return { valid: true };
}

/**
 * Bot identification and overlap detection.
 *
 * A trade/position reported by the gateway is attributed to a bot using the
 * strongest available combination:
 *   1. Magic Number (primary — exact match, non-empty)
 *   2. MT5 account (binding)
 *   3. Symbol (when magic matches multiple bots)
 *   4. Order/position comment (when the EA exposes it)
 *
 * Marketplace bots are matched the same way once their mapping is set.
 */
export type BotMatch = {
    bot: UserBot;
    byMagic: boolean;
    byComment: boolean;
};

export function botMatchesTrade(
    bot: UserBot,
    account: string,
    magic: unknown,
    symbol: string,
    comment: string
): BotMatch | null {
    const botMagic = String(bot.magicNumber || "").trim();
    const magicStr = magic === null || magic === undefined || magic === "" ? "" : String(magic).trim();

    let matchesAccount = true;
    if (bot.mt5Account && account) {
        matchesAccount = String(bot.mt5Account) === String(account);
    }
    if (!matchesAccount) return null;

    let matchesComment = true;
    if (bot.commentFilter) {
        const filter = String(bot.commentFilter).toLowerCase();
        matchesComment = filter === "" || comment.toLowerCase().includes(filter) || magicStr === filter;
    }

    let matchesSymbol = true;
    if (bot.symbol && symbol) {
        matchesSymbol = String(bot.symbol).toLowerCase() === String(symbol).toLowerCase();
    }

    const byMagic = botMagic !== "" && botMagic === magicStr;
    if (byMagic && matchesAccount) {
        // When a single magic maps to several symbols, prefer exact symbol.
        return { bot, byMagic: true, byComment: matchesComment };
    }

    // Fallback: mapping match via symbol/comment when magic is not trusted.
    if (!byMagic && matchesSymbol && matchesComment && matchesAccount) {
        return { bot, byMagic: false, byComment: true };
    }

    return null;
}

export async function findMatchingBots(
    userId: string,
    account: string,
    magic: unknown,
    symbol: string,
    comment: string
): Promise<BotMatch[]> {
    const bots = await listUserBots(userId);
    const matches: BotMatch[] = [];
    for (const bot of bots) {
        if (bot.status === "disconnected") continue;
        const match = botMatchesTrade(bot, account, magic, symbol, comment);
        if (match) matches.push(match);
    }
    return matches;
}

/**
 * Returns bots (for this user, on this account) that ALREADY reference the
 * given magic — used for the "WARNING: magic already assigned" UX. Exact magic
 * must never be silently overwritten.
 */
export async function findBotsWithMagic(userId: string, mt5Account: string, magic: string): Promise<UserBot[]> {
    const bots = await listUserBots(userId);
    const magicStr = String(magic || "").trim();
    if (!magicStr) return [];
    return bots.filter((b) => {
        if (String(b.magicNumber || "").trim() !== magicStr) return false;
        if (b.mt5Account && String(b.mt5Account) === String(mt5Account)) return true;
        return !b.mt5Account;
    });
}

/**
 * Per-bot trade/position indexing.
 *
 * Marketplace trades keep living under `trades/{productId}_{mt5Account}` —
 * the canonical per-product store consumed by the live marketplace. For bot
 * attribution (custom + marketplace) we additionally write an index under
 * `bot_trades/{botId}/{ticket}` and `bot_positions/{botId}/{ticket}` using
 * the SAME field schema plus `botId`/`magic`/`comment`. Re-writing an
 * existing ticket is a no-op update (idempotent — no duplicates).
 */
export async function indexBotTrade(botId: string, trade: Record<string, unknown>): Promise<void> {
    const ticket = String(trade.ticket || trade.tradeId || "");
    if (!ticket) return;
    const ref = adminDatabase.ref(`bot_trades/${botId}/${ticket}`);
    const existing = (await ref.get()).val() as Record<string, unknown> | null;
    const now = Date.now();
    await ref.set({
        ...trade,
        botId,
        ticket: String(trade.ticket || ticket),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    });
}

export async function indexBotPosition(botId: string, position: Record<string, unknown>): Promise<void> {
    const ticket = String(position.ticket || "");
    if (!ticket) return;
    const now = Date.now();
    await adminDatabase.ref(`bot_positions/${botId}/${ticket}`).set({
        ...position,
        botId,
        updatedAt: now,
    });
}

export async function clearBotPositions(botId: string, keepTickets: string[]): Promise<void> {
    const snap = await adminDatabase.ref(`bot_positions/${botId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    const keep = new Set(keepTickets.map(String));
    await Promise.all(
        Object.keys(data)
            .filter((t) => !keep.has(String(t)))
            .map((t) => adminDatabase.ref(`bot_positions/${botId}/${t}`).remove())
    );
}

/**
 * Bot-level performance stats.
 *
 * Equity is a property of the MT5 account, not of a single bot — the account
 * equity curve is never attributed to a bot. Bot "P/L" is computed ONLY from
 * the bot's own realized trades plus its current floating position P/L:
 *
 *   totalPnl   = Σ realized (profit + commission + swap) over closed trades
 *                + Σ floating P/L over currently open positions.
 *   todayPnl   = realized P/L of trades closed today + floating P/L of
 *                positions opened after the start of today.
 *   profitFactor = grossProfit / |grossLoss|  (∞ when no losing trades).
 *   maxDrawdown  = peak-to-trough drop of the cumulative realized P/L curve
 *                  (does NOT measure account equity drawdown).
 *
 * This keeps bot performance strictly based on actual recorded data.
 */
export type BotStats = {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    totalPnl: number;
    todayPnl: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    maxDrawdown: number;
    avgHoldingTimeMs: number;
};

export type PositionSummary = {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    swap: number;
    openPrice: number;
    currentPrice: number;
    magic: string;
    openedAt: number;
    comment: string;
};

export function computeBotStats(trades: Record<string, unknown>[], positions: Record<string, unknown>[] | PositionSummary[]): BotStats {
    let realized = 0;
    let todayRealized = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;
    let best = -Infinity;
    let worst = Infinity;
    let sumWin = 0;
    let sumLoss = 0;
    let totalHolding = 0;
    let holdingCount = 0;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const curve: number[] = [];
    let cum = 0;

    for (const raw of trades) {
        if (!raw || typeof raw !== "object") continue;
        const profit = Number(raw.profit || 0);
        const commission = Number(raw.commission || 0);
        const swap = Number(raw.swap || 0);
        const net = profit + commission + swap;

        realized += net;

        const closedAt = Number(raw.closedAt || 0);
        if (closedAt >= startOfDay.getTime()) todayRealized += net;

        if (net >= 0) {
            wins += 1;
            sumWin += net;
            grossProfit += net;
        } else {
            losses += 1;
            sumLoss += Math.abs(net);
            grossLoss += Math.abs(net);
        }

        if (net > best) best = net;
        if (net < worst) worst = net;

        cum += net;
        curve.push(cum);

        const openedAt = Number(raw.openedAt || 0);
        if (openedAt > 0 && closedAt > 0 && closedAt > openedAt) {
            totalHolding += closedAt - openedAt;
            holdingCount += 1;
        }
    }

    let floating = 0;
    let todayFloating = 0;
    for (const p of positions || []) {
        if (!p || typeof p !== "object") continue;
        const profit = Number(p.profit || 0);
        const swap = Number(p.swap || 0);
        floating += profit + swap;
        const openedAt = Number(p.openedAt || 0);
        if (openedAt >= startOfDay.getTime()) todayFloating += profit + swap;
    }

    const totalTrades = wins + losses;
    const totalPnl = realized + floating;
    const todayPnl = todayRealized + todayFloating;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    let maxDrawdown = 0;
    let peak = -Infinity;
    for (const v of curve) {
        if (v > peak) peak = v;
        const dd = peak - v;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
        totalTrades,
        wins,
        losses,
        winRate: Math.round(winRate * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossLoss: Math.round(grossLoss * 100) / 100,
        profitFactor,
        totalPnl: Math.round(totalPnl * 100) / 100,
        todayPnl: Math.round(todayPnl * 100) / 100,
        avgWin: wins > 0 ? Math.round((sumWin / wins) * 100) / 100 : 0,
        avgLoss: losses > 0 ? Math.round((sumLoss / losses) * 100) / 100 : 0,
        bestTrade: best === -Infinity ? 0 : Math.round(best * 100) / 100,
        worstTrade: worst === Infinity ? 0 : Math.round(worst * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        avgHoldingTimeMs: holdingCount > 0 ? Math.round(totalHolding / holdingCount) : 0,
    };
}

export async function loadBotTrades(botId: string): Promise<Record<string, unknown>[]> {
    const snap = await adminDatabase.ref(`bot_trades/${botId}`).get();
    const data = snap.val() as Record<string, unknown> | null | undefined;
    if (!data || typeof data !== "object") return [];
    return Object.values(data).filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object" && !Array.isArray(t));
}

export async function loadBotPositions(botId: string): Promise<PositionSummary[]> {
    const snap = await adminDatabase.ref(`bot_positions/${botId}`).get();
    const data = snap.val() as Record<string, unknown> | null | undefined;
    if (!data || typeof data !== "object") return [];
    return Object.values(data)
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object" && !Array.isArray(p))
        .map((p) => {
            const raw = p as Record<string, unknown>;
            return {
                ticket: String(raw.ticket || ""),
                symbol: String(raw.symbol || ""),
                type: String(raw.type || ""),
                volume: Number(raw.volume || 0),
                profit: Number(raw.profit || 0),
                swap: Number(raw.swap || 0),
                openPrice: Number(raw.openPrice || 0),
                currentPrice: Number(raw.currentPrice || 0),
                magic: String(raw.magic || ""),
                openedAt: Number(raw.openedAt || 0),
                comment: String(raw.comment || ""),
            };
        })
        .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

/**
 * Marks the user's bots online (based on gateway-reported activity) and
 * updates their installation + heartbeat stamp. Called alongside gateway
 * register/heartbeat so the gateway stays the single heartbeat source.
 */
export async function syncBotStatuses(
    userId: string,
    accountNumber: string,
    gatewayInstallationId: string | null,
    botsReported: unknown[],
    now: number
): Promise<void> {
    const bots = await listUserBots(userId);
    if (bots.length === 0) return;

    const reportedIds = new Set<string>();
    for (const raw of botsReported || []) {
        if (!raw || typeof raw !== "object") continue;
        const id = String((raw as Record<string, unknown>).botId || "").trim();
        if (id) reportedIds.add(id);
    }

    for (const bot of bots) {
        const accountMatches = !bot.mt5Account || String(bot.mt5Account) === String(accountNumber);
        const reported = reportedIds.has(bot.id);
        if (!accountMatches && !reported) continue;

        await adminDatabase.ref(`user_bots/${bot.id}`).update({
            online: true,
            status: bot.status === "disconnected" ? bot.status : "active",
            lastHeartbeatAt: now,
            gatewayInstallationId: gatewayInstallationId || bot.gatewayInstallationId || null,
            updatedAt: now,
        });
    }
}

/**
 * Magics that belong to the user's registered bots on the given account.
 * Used by the gateway snapshot route to keep custom-EA activity out of the
 * live marketplace / copy-trading pipeline.
 */
export async function getBotOwnedMagics(userId: string, mt5Account: string): Promise<string[]> {
    const bots = await listUserBots(userId);
    const magics = new Set<string>();
    for (const bot of bots) {
        const magic = String(bot.magicNumber || "").trim();
        if (!magic) continue;
        const botAccount = String(bot.mt5Account || "").trim();
        if (botAccount && botAccount !== String(mt5Account)) continue;
        magics.add(magic);
    }
    return Array.from(magics);
}

/** Bot lifecycle notifications reuse the platform notification system. */
export async function notifyBotEvent(bot: UserBot, payload: { title: string; message: string; level?: "info" | "success" | "warning" | "error" }) {
    await notifyUser(bot.ownerId, {
        title: payload.title,
        message: `${bot.name} (${bot.id})\n${payload.message}`,
        level: payload.level || "info",
        link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/account/bots/${bot.id}`,
    });
}