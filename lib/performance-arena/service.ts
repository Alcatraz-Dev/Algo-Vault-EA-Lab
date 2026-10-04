// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — server-side service (the ONLY writer of arena state).
//
// Every critical calculation happens here, server-side: fills, PnL, equity,
// drawdown, daily loss, rule evaluation, settlement and rewards. The client
// only ever submits intent (symbol, side, size, stop) — never numbers that
// affect accounting. Timestamps come from the server clock; prices come from
// the canonical live-price resolver (Biquote forming candle → TradingView
// scanner). Market data unavailable ⇒ fail-closed (reject / pause), never a
// fabricated price.
//
// Idempotency: order placement dedupes on clientRequestId, settlement uses a
// status CAS, reward ledger entries derive deterministic ids and are written
// with set-if-absent transactions. Replaying any request cannot double-fill,
// double-settle or double-grant.
// ─────────────────────────────────────────────────────────────────────────────

import { tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import { getCurrentSession, isMarketOpen } from "@/lib/analytics/sessions";
import { checkAccess } from "@/lib/strategy-lab/license";
import { defaultLeaderboardPolicy } from "./policies";
import { isArenaEnabled, isCatalogEnabled, isPlatformRewardsEnabled } from "./flags";
import { evaluateEntitlement, type AccessEvaluation } from "./entitlement";
import {
    computeFill,
    computeExit,
    markPosition,
    arenaSymbolSpec,
    contractSizeOf,
    stopLossHit,
    takeProfitHit,
} from "./execution";
import { computeMetrics, dayKeyOf, dailyPnlSeries } from "./metrics";
import { evaluateAccountRules, evaluatePreTrade } from "./rules";
import { applyTransition, InvalidTransitionError } from "./state-machine";
import {
    evaluateSettlement,
    buildChallengeResult,
    passRequirements,
    settlementExplanation,
    type PassRequirement,
    type SettlementVerdict,
} from "./settlement";
import { buildGuardianInsights, buildGuardianPrompt, parseGuardianAIResponse, type GuardianInput } from "./guardian";
import {
    planRewards,
    applyRewardToWallet,
    consumeAiCredits,
    emptyWallet,
    rtdbSlug,
} from "./rewards";
import { evaluateRewardEligibility } from "./eligibility";
import { runFraudDetections, detectImpossibleExecution, type FraudDetectionContext } from "./fraud";
import { buildLeaderboardEntries, buildLeaderboardSnapshot } from "./leaderboard";
import { buildTraderProfile, type ProfileHistoryItem } from "./profile";
import * as store from "./store";
import { toPriceMicros, plannedRiskCents } from "./money";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import {
    ARENA_DISCLAIMERS,
    isTerminalStatus,
    type ChallengeAttempt,
    type ChallengeDefinition,
    type ChallengePendingOrder,
    type ChallengeEvent,
    type ChallengeMetrics,
    type ChallengePolicy,
    type ChallengeResult,
    type ChallengeTrade,
    type GuardianAIAnalysis,
    type GuardianInsight,
    type LeaderboardSnapshot,
    type MarkedTrade,
    type PerformanceReport,
    type RuleEvent,
    type TraderPerformanceProfile,
    type VirtualAccount,
} from "./types";

const FRESH_QUOTE_MS = 60_000;
const EQUITY_POINT_MIN_GAP_MS = 60_000;
const LEADERBOARD_REFRESH_MS = 300_000;
const MAX_ACTIVE_ATTEMPTS = 3;
const GUARDIAN_AI_COST_CREDITS = 1;

export class ArenaError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details?: unknown
    ) {
        super(message);
        this.name = "ArenaError";
    }
}

// ──────────── Clock / id helpers (server-authoritative) ──────────────────────

let eventSeq = 0;
function nextEventId(prefix = "evt"): string {
    eventSeq = (eventSeq + 1) % 1_000_000;
    return `${prefix}_${Date.now().toString(36)}_${eventSeq.toString(36)}`;
}

/**
 * Deterministic per-hour bucket id for rule events so repeated evaluations
 * within the same hour collapse to one stored event (idempotent writes).
 */
function ruleEventId(ruleId: string, type: string, now: number): string {
    const hour = Math.floor(now / 3_600_000);
    return rtdbSlug(`evt_rule_${ruleId}_${type}_${hour}`);
}

function makeRuleContext(attempt: ChallengeAttempt, policy: ChallengePolicy, metrics: ChallengeMetrics, now: number) {
    return { attempt, policy, metrics, now, nextEventId: () => nextEventId("rule") };
}

// ──────────── Quotes ─────────────────────────────────────────────────────────

export interface ArenaQuote {
    symbol: string;
    price: number;
    timestamp: number;
    provider: string;
}

const MARKET_DATA_SYMBOLS = new Set<string>(SUPPORTED_SYMBOLS);

const ARENA_SYMBOL_ALIASES: Record<string, string> = {
    GOLD: "XAUUSD", XAU: "XAUUSD", SILVER: "XAGUSD",
    SP500: "SPX500", US500: "SPX500", S500: "SPX500", SPX: "SPX500",
    DJIA: "US30", DOW: "US30", NDX: "NAS100", NASDAQ100: "NAS100",
    BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSD",
};

export function normalizeArenaSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase().replaceAll("/", "");
    const alias = ARENA_SYMBOL_ALIASES[normalized] ?? normalized;
    return getSymbolSpec(alias)?.symbol ?? alias;
}

export async function resolveQuote(symbol: string): Promise<ArenaQuote | null> {
    const normalized = symbol.trim().toUpperCase();
    if (!MARKET_DATA_SYMBOLS.has(normalized)) return null;
    try {
        const quote = await tradingViewLivePriceCache.get(normalized);
        if (!quote || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.timestamp)) return null;
        return { symbol: normalized, price: quote.price, timestamp: quote.timestamp, provider: quote.provider };
    } catch {
        return null;
    }
}

async function resolveQuotes(symbols: string[]): Promise<Map<string, ArenaQuote>> {
    const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
    const results = await Promise.all(unique.map((s) => resolveQuote(s)));
    const map = new Map<string, ArenaQuote>();
    results.forEach((q, i) => {
        if (q) map.set(unique[i], q);
    });
    return map;
}

// ──────────── Event helpers ──────────────────────────────────────────────────

async function persistRuleEvents(uid: string, attemptId: string, events: RuleEvent[], now: number): Promise<void> {
    for (const ev of events) {
        const challengeEvent: ChallengeEvent = {
            eventId: ruleEventId(ev.ruleId, ev.type, now),
            attemptId,
            type: ev.severity === "BREACH" ? "RULE_BREACH" : "RULE_WARNING",
            severity: ev.severity === "BREACH" ? "critical" : ev.severity === "WARNING" ? "warning" : "info",
            message: ev.message,
            payload: {
                ruleId: ev.ruleId,
                ruleType: ev.type,
                currentValue: ev.currentValue,
                threshold: ev.threshold,
                percentageUsed: ev.percentageUsed,
                blocking: ev.blocking,
            },
            timestamp: now,
        };
        await store.writeEvent(uid, challengeEvent);
    }
}

async function persistEvent(uid: string, event: ChallengeEvent): Promise<void> {
    await store.writeEvent(uid, event);
}

async function pauseForStaleData(uid: string, attempt: ChallengeAttempt, now: number, symbols: string): Promise<void> {
    if (attempt.status !== "ACTIVE") return;
    const transition = applyTransition({
        attemptId: attempt.id,
        from: attempt.status,
        to: "PAUSED",
        timestamp: now,
        reason: `Current market data unavailable for ${symbols}; trading paused until quotes recover.`,
        eventId: nextEventId("evt"),
        actor: "system",
    });
    if (!transition.changed) return;
    const paused: ChallengeAttempt = {
        ...attempt,
        status: "PAUSED",
        updatedAt: now,
        pausedAt: now,
        settleBlockedReason: "STALE_MARKET_DATA",
    };
    await store.saveAttempt(paused);
    if (transition.event) await persistEvent(uid, transition.event);
}

// ──────────── Access / entitlement (server-side Pro gating) ──────────────────
//
// The decision logic lives in ./entitlement (pure, unit-tested offline). This
// wrapper injects the production dependencies — both resolved server-side,
// never from client input:
//   · checkEntitlement → Strategy Lab checkAccess (the canonical Pro/license
//     gate shared with Strategy Lab / Strategy Research)
//   · getWalletPoints  → RTDB AV Points wallet (missing wallet ⇒ 0 points,
//     fail-closed: never a free entry)

export type { AccessEvaluation } from "./entitlement";

export async function evaluateAccess(uid: string, definition: ChallengeDefinition): Promise<AccessEvaluation> {
    return evaluateEntitlement(uid, definition, {
        checkEntitlement: checkAccess,
        getWalletPoints: async (userId) => (await store.getWallet(userId))?.avPoints ?? 0,
        checkPaidChallengeGrant: async (userId, defId) => {
            const grant = await store.getPaidGrant(userId, defId);
            return !!grant && !grant.consumed;
        },
    });
}

// ──────────── Catalog ────────────────────────────────────────────────────────

export interface CatalogItem {
    definition: ChallengeDefinition;
    access: AccessEvaluation;
    eligibility: ReturnType<typeof evaluateRewardEligibility>;
    activeAttemptId: string | null;
    disclaimers: string[];
}

export async function getCatalog(uid: string): Promise<{ items: CatalogItem[]; activeAttemptCount: number }> {
    if (!isCatalogEnabled()) throw new ArenaError(503, "CATALOG_DISABLED", "Challenge catalog is currently disabled.");
    const [definitions, attempts] = await Promise.all([store.listDefinitions(), store.listAttempts(uid, 50)]);
    const active = attempts.filter((a) => !isTerminalStatus(a.status));

    const items: CatalogItem[] = [];
    for (const definition of definitions.filter((d) => d.enabled && d.status === "AVAILABLE")) {
        const access = await evaluateAccess(uid, definition);
        items.push({
            definition,
            access,
            eligibility: evaluateRewardEligibility({
                country: null,
                program: definition.key,
                rewardType: "PLATFORM_POINTS",
                productRuleSatisfied: access.allowed,
                productRuleReason: access.reason,
            }),
            activeAttemptId: active.find((a) => a.definitionId === definition.id)?.id ?? null,
            disclaimers: [ARENA_DISCLAIMERS.simulated, ARENA_DISCLAIMERS.rewards],
        });
    }
    return { items, activeAttemptCount: active.length };
}

// ──────────── Join challenge ─────────────────────────────────────────────────

function newAccount(uid: string, attemptId: string, startingBalanceCents: number, now: number): VirtualAccount {
    return {
        accountId: store.rtdbKey(`acct_${attemptId}`),
        attemptId,
        userId: uid,
        startingBalanceCents,
        balanceCents: startingBalanceCents,
        equityCents: startingBalanceCents,
        peakEquityCents: startingBalanceCents,
        realizedPnLCents: 0,
        unrealizedPnLCents: 0,
        feesCents: 0,
        dayStartEquityCents: startingBalanceCents,
        dayKey: dayKeyOf(now),
        dailyPnLCcents: 0,
        exposureCents: 0,
        lastQuoteAt: now,
        createdAt: now,
        updatedAt: now,
    };
}

export async function joinChallenge(uid: string, definitionId: string, paidOrderId?: string): Promise<ChallengeAttempt> {
    if (!isArenaEnabled()) throw new ArenaError(503, "ARENA_DISABLED", "Performance Arena is currently disabled.");

    const definition = await store.getDefinition(definitionId);
    if (!definition || !definition.enabled || definition.status !== "AVAILABLE") {
        throw new ArenaError(404, "CHALLENGE_NOT_FOUND", "Challenge not found or not available.");
    }

    const paidGrant = definition.access.model === "paid"
        ? paidOrderId
            ? await store.getPaidGrantByOrder(uid, paidOrderId)
            : await store.getPaidGrant(uid, definition.id)
        : null;
    if (definition.access.model === "paid" && (!paidGrant || paidGrant.definitionId !== definition.id || (paidOrderId && paidGrant.orderId !== paidOrderId))) {
        throw new ArenaError(403, "PURCHASE_REQUIRED", "A verified purchase for this challenge is required.");
    }
    // Retry for the same order resumes its assigned attempt id. If the first
    // provisioning request stopped after claiming the grant, recreate missing
    // resources at that same id without issuing a second account.
    if (definition.access.model === "paid" && paidOrderId && paidGrant?.consumed && paidGrant.attemptId) {
        const resumed = await store.getAttempt(uid, paidGrant.attemptId);
        if (resumed) return resumed;
    }

    const access = await evaluateAccess(uid, definition);
    const retryingClaimedOrder = definition.access.model === "paid" && Boolean(paidOrderId && paidGrant?.consumed && paidGrant.attemptId);
    if (!access.allowed && !retryingClaimedOrder) throw new ArenaError(403, "ACCESS_DENIED", access.reason ?? "Access denied.");

    const attempts = await store.listAttempts(uid, 50);
    const active = attempts.filter((a) => !isTerminalStatus(a.status));
    if (active.some((a) => a.definitionId === definition.id)) {
        throw new ArenaError(409, "ALREADY_ACTIVE", "You already have an active attempt on this challenge.");
    }
    if (active.length >= MAX_ACTIVE_ATTEMPTS) {
        throw new ArenaError(409, "TOO_MANY_ACTIVE", `You can hold at most ${MAX_ACTIVE_ATTEMPTS} active challenges.`);
    }

    const now = Date.now();
    const attemptId = retryingClaimedOrder && paidGrant?.attemptId ? paidGrant.attemptId : store.newArenaId("att");

    // Paid access consumes one verified order grant atomically. A retry on
    // the exact order resumes its original id; it cannot claim a second time.
    if (definition.access.model === "paid") {
        const claimed = await store.claimPaidGrant(uid, definition.id, attemptId, paidGrant?.orderId);
        if (!claimed) {
            throw new ArenaError(403, "PURCHASE_REQUIRED", "A verified, unused purchase for this challenge is required.");
        }
    }

    // Points-priced entry: debit AV Points idempotently BEFORE creating the
    // attempt (deterministic spend id keyed to this attempt).
    if (definition.access.model === "credits") {
        const wallet = await store.getWallet(uid);
        const cost = definition.access.pricePoints ?? 0;
        if (wallet.avPoints < cost) throw new ArenaError(403, "INSUFFICIENT_POINTS", `Requires ${cost} AV Points.`);
        const debitEntry = {
            rewardId: store.rtdbKey(`sp_entry_${attemptId}_${definition.id}_${uid}`),
            userId: uid,
            sourceType: "POINTS_SPEND" as const,
            sourceId: attemptId,
            rewardType: "PLATFORM_POINTS" as const,
            amount: -cost,
            unit: "AV_POINTS",
            policyId: "challenge-entry",
            status: "GRANTED" as const,
            createdAt: now,
            grantedAt: now,
            revokedAt: null,
            metadata: { definitionId: definition.id, direction: "debit" as const },
        };
        const created = await store.writeLedgerEntry(debitEntry);
        if (created) {
            const next = { ...wallet, avPoints: Math.max(0, wallet.avPoints - cost), updatedAt: now };
            await store.saveWallet(next);
        }
    }

    const attempt: ChallengeAttempt = {
        id: attemptId,
        userId: uid,
        definitionId: definition.id,
        definitionKey: definition.key,
        policy: definition.policy,
        rewardPolicyId: definition.rewardPolicyId,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        expiresAt: now + definition.policy.maxCalendarDays * 24 * 60 * 60 * 1000,
        settledAt: null,
        result: null,
        tradingDayKeys: {},
        dailyTradeCounts: {},
    };
    // Provision account before publishing the attempt. If the process fails
    // between these writes, an order retry reuses the account id and can finish
    // creating the attempt without resetting any balance.
    await store.createAccountIfAbsent(newAccount(uid, attemptId, definition.policy.startingBalanceCents, now));
    const createdAttempt = await store.createAttemptIfAbsent(attempt);
    if (!createdAttempt.created) {
        // Two concurrent requests may have claimed the same paid order. Only
        // one publishes the attempt/start event/analytics record.
        return createdAttempt.attempt;
    }

    await persistEvent(uid, {
        eventId: nextEventId("evt"),
        attemptId,
        type: "STATUS_CHANGE",
        severity: "info",
        message: `Challenge started: ${definition.name} (virtual capital $${(definition.policy.startingBalanceCents / 100).toFixed(2)}). ${ARENA_DISCLAIMERS.simulated}`,
        payload: { definitionId: definition.id, from: "AVAILABLE", to: "ACTIVE" },
        timestamp: now,
    });

    await store.bumpAnalytics(store.dayKeyNow(now), {
        challengeStarts: 1,
        ...(definition.access.model === "paid" ? { paidChallengeStarts: 1 } : {}),
        ...(definition.access.model === "pro" ? { proChallengeStarts: 1 } : {}),
    });

    // Privacy-conscious fraud scan (duplicate/reset abuse).
    const ctx: FraudDetectionContext = { userId: uid, attempt, now, recentAttempts: attempts, nextFlagId: () => nextEventId("ff") };
    for (const flag of runFraudDetections({ ctx })) await store.writeFraudFlag(flag);

    return attempt;
}

// ──────────── Mark-to-market + metrics ──────────────────────────────────────

async function markAccountToMarket(
    uid: string,
    attempt: ChallengeAttempt,
    account: VirtualAccount,
    openTrades: ChallengeTrade[],
    now: number
): Promise<{ account: VirtualAccount; marks: Array<{ tradeId: string; unrealizedPnLCents: number; markPriceMicros: number | null; quoteAt: number | null }>; quoteAt: number | null; quotes: Map<string, ArenaQuote> }> {
    const quotes = await resolveQuotes(openTrades.map((t) => t.symbol));

    let unrealized = 0;
    const marks: Array<{ tradeId: string; unrealizedPnLCents: number; markPriceMicros: number | null; quoteAt: number | null }> = [];
    let freshest: number | null = null;

    for (const trade of openTrades) {
        const quote = quotes.get(trade.symbol);
        const spec = arenaSymbolSpec(trade.symbol);
        const contractSize = spec?.contractSize ?? contractSizeOf(trade.symbol);
        if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS || !spec) {
            marks.push({ tradeId: trade.tradeId, unrealizedPnLCents: 0, markPriceMicros: null, quoteAt: null });
            continue;
        }
        const marked = markPosition({
            side: trade.side,
            entryPriceMicros: trade.entryPriceMicros,
            sizeCentiLots: trade.sizeCentiLots,
            contractSize,
            quotePrice: quote.price,
            costs: trade.costs,
        });
        unrealized += marked.unrealizedPnLCents;
        freshest = freshest === null ? quote.timestamp : Math.max(freshest, quote.timestamp);
        marks.push({ tradeId: trade.tradeId, unrealizedPnLCents: marked.unrealizedPnLCents, markPriceMicros: marked.markPriceMicros, quoteAt: quote.timestamp });
    }

    const nowKey = dayKeyOf(now);
    let next: VirtualAccount = { ...account };
    if (next.dayKey !== nowKey) {
        // Day rollover: the daily loss base becomes today's opening equity.
        const equityAtRoll = next.balanceCents + unrealized;
        next = { ...next, dayKey: nowKey, dayStartEquityCents: equityAtRoll, dailyPnLCcents: 0 };
    }

    const equity = next.balanceCents + unrealized;
    // null when open positions could not be marked → metrics treat as stale.
    const quoteAt = openTrades.length > 0 ? freshest : now;

    next = {
        ...next,
        equityCents: equity,
        unrealizedPnLCents: unrealized,
        peakEquityCents: Math.max(next.peakEquityCents, equity),
        dailyPnLCcents: equity - next.dayStartEquityCents,
        lastQuoteAt: quoteAt ?? next.lastQuoteAt,
        updatedAt: now,
    };

    await store.saveAccount(next);
    return { account: next, marks, quoteAt, quotes };
}

function buildMetrics(params: {
    attempt: ChallengeAttempt;
    account: VirtualAccount;
    openTrades: ChallengeTrade[];
    closedTrades: ChallengeTrade[];
    marks: Array<{ tradeId: string; unrealizedPnLCents: number; markPriceMicros: number | null; quoteAt: number | null }>;
    quoteAt: number | null;
    now: number;
    equityCurve: Array<{ t: number; equityCents: number }>;
}): ChallengeMetrics {
    return computeMetrics({
        attempt: params.attempt,
        account: params.account,
        policy: params.attempt.policy,
        openTrades: params.openTrades,
        closedTrades: params.closedTrades,
        marks: params.marks,
        quoteAt: params.quoteAt,
        now: params.now,
        equityCurve: params.equityCurve,
    });
}

// ──────────── Protective order triggers (server-side) ───────────────────

/**
 * Evaluate stop-loss / take-profit for every open position against the
 * resolved quotes. Hits close AT THE TRIGGER LEVEL (deterministic, no
 * slippage on protective exits — costs were fixed at entry) and persist a
 * TRADE_CLOSED event with the exit reason.
 */
async function triggerProtectiveOrders(
    uid: string,
    attempt: ChallengeAttempt,
    openTrades: ChallengeTrade[],
    quotes: Map<string, ArenaQuote>,
    now: number
): Promise<{ trades: ChallengeTrade[]; closedAny: boolean }> {
    if (openTrades.length === 0) return { trades: openTrades, closedAny: false };

    let account = await store.getAccount(uid, attempt.id);
    if (!account) return { trades: openTrades, closedAny: false };

    const stillOpen: ChallengeTrade[] = [];
    let closedAny = false;

    for (const trade of openTrades) {
        const quote = quotes.get(trade.symbol);
        if (!quote) {
            stillOpen.push(trade);
            continue;
        }
        const hitStop = trade.stopLossMicros !== null && stopLossHit(trade.side, trade.stopLossMicros, quote.price);
        const hitTp = trade.takeProfitMicros !== null && takeProfitHit(trade.side, trade.takeProfitMicros, quote.price);
        if (!hitStop && !hitTp) {
            stillOpen.push(trade);
            continue;
        }

        const triggerMicros = hitStop ? trade.stopLossMicros! : trade.takeProfitMicros!;
        const triggerPrice = triggerMicros / 1_000_000;
        const spec = arenaSymbolSpec(trade.symbol);
        const contractSize = spec?.contractSize ?? contractSizeOf(trade.symbol);
        const exit = computeExit({
            side: trade.side,
            entryPriceMicros: trade.entryPriceMicros,
            sizeCentiLots: trade.sizeCentiLots,
            contractSize,
            quotePrice: triggerPrice,
            costs: trade.costs,
        });

        const closed: ChallengeTrade = {
            ...trade,
            status: "closed",
            closedAt: now,
            exitPriceMicros: exit.exitPriceMicros,
            exitQuoteAt: quote.timestamp,
            exitReason: hitStop ? "stop_loss" : "take_profit",
            realizedPnLCents: exit.netPnLCents,
        };
        await store.saveTrade(closed);
        closedAny = true;

        account = {
            ...account,
            realizedPnLCents: account.realizedPnLCents + exit.netPnLCents,
            balanceCents: account.startingBalanceCents + account.realizedPnLCents + exit.netPnLCents,
            updatedAt: now,
        };

        await persistEvent(uid, {
            eventId: nextEventId("evt"),
            attemptId: attempt.id,
            type: "TRADE_CLOSED",
            severity: "info",
            message: `${trade.symbol} ${trade.side} closed by ${hitStop ? "stop-loss" : "take-profit"} at ${triggerPrice} — net ${exit.netPnLCents >= 0 ? "+" : ""}${(exit.netPnLCents / 100).toFixed(2)} virtual.`,
            payload: { tradeId: trade.tradeId, exitReason: hitStop ? "stop_loss" : "take_profit", netPnLCents: exit.netPnLCents },
            timestamp: now,
        });
    }

    if (closedAny) {
        const flat = account.balanceCents;
        account = {
            ...account,
            equityCents: flat,
            unrealizedPnLCents: 0,
            peakEquityCents: Math.max(account.peakEquityCents, flat),
            dailyPnLCcents: flat - account.dayStartEquityCents,
            updatedAt: now,
        };
        await store.saveAccount(account);
    }

    return { trades: stillOpen, closedAny };
}

// ──────────── Settlement orchestration ──────────────────────────────────────

export interface SettleOutcome {
    settled: boolean;
    verdict: SettlementVerdict;
    attempt: ChallengeAttempt;
    result?: PerformanceReport;
}

async function closeAllOpenPositions(
    uid: string,
    attempt: ChallengeAttempt,
    openTrades: ChallengeTrade[],
    reason: "challenge_end" | "breach_close",
    quotes: Map<string, ArenaQuote>,
    now: number
): Promise<{ trades: ChallengeTrade[]; account: VirtualAccount | null; blocked?: string }> {
    const account = await store.getAccount(uid, attempt.id);
    if (!account) return { trades: openTrades, account: null, blocked: "ACCOUNT_MISSING" };

    let currentAccount = account;
    const closed: ChallengeTrade[] = [];

    for (const trade of openTrades) {
        const quote = quotes.get(trade.symbol);
        if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) {
            // Fail-closed: no fresh quote ⇒ do not guess an exit price.
            return { trades: openTrades, account: null, blocked: "STALE_MARKET_DATA" };
        }
        const spec = arenaSymbolSpec(trade.symbol);
        const contractSize = spec?.contractSize ?? contractSizeOf(trade.symbol);
        const exit = computeExit({
            side: trade.side,
            entryPriceMicros: trade.entryPriceMicros,
            sizeCentiLots: trade.sizeCentiLots,
            contractSize,
            quotePrice: quote.price,
            costs: trade.costs,
        });
        const updated: ChallengeTrade = {
            ...trade,
            status: "closed",
            closedAt: now,
            exitPriceMicros: exit.exitPriceMicros,
            exitQuoteAt: quote.timestamp,
            exitReason: reason,
            realizedPnLCents: exit.netPnLCents,
        };
        await store.saveTrade(updated);
        closed.push(updated);

        currentAccount = {
            ...currentAccount,
            realizedPnLCents: currentAccount.realizedPnLCents + exit.netPnLCents,
            balanceCents: currentAccount.startingBalanceCents + currentAccount.realizedPnLCents + exit.netPnLCents,
        };
    }

    const flatEquity = currentAccount.balanceCents;
    currentAccount = {
        ...currentAccount,
        equityCents: flatEquity,
        unrealizedPnLCents: 0,
        peakEquityCents: Math.max(currentAccount.peakEquityCents, flatEquity),
        dailyPnLCcents: flatEquity - currentAccount.dayStartEquityCents,
        updatedAt: now,
    };
    await store.saveAccount(currentAccount);

    for (const trade of closed) {
        await persistEvent(uid, {
            eventId: nextEventId("evt"),
            attemptId: attempt.id,
            type: "TRADE_CLOSED",
            severity: "info",
            message: `${trade.symbol} ${trade.side} closed at settlement (${reason}) — net ${((trade.realizedPnLCents ?? 0) / 100).toFixed(2)} virtual.`,
            payload: { tradeId: trade.tradeId, reason, netPnLCents: trade.realizedPnLCents },
            timestamp: now,
        });
    }

    return { trades: closed, account: currentAccount };
}

async function settleAttempt(
    uid: string,
    attempt: ChallengeAttempt,
    verdict: Extract<SettlementVerdict, { action: "settle" }>,
    opts: { now: number; openTrades: ChallengeTrade[]; closedTrades: ChallengeTrade[]; account: VirtualAccount | null; metrics: ChallengeMetrics; ruleBreachCount: number }
): Promise<SettleOutcome> {
    const { now } = opts;
    let openTrades = opts.openTrades;
    let closedTrades = opts.closedTrades;
    let account = opts.account;
    let metrics = opts.metrics;

    // Close any open positions first (quotes required — fail-closed above).
    if (openTrades.length > 0 && account) {
        const symbols = openTrades.map((t) => t.symbol);
        const quotes = await resolveQuotes(symbols);
        const closed = await closeAllOpenPositions(
            uid,
            attempt,
            openTrades,
            verdict.status === "PASSED" ? "challenge_end" : "breach_close",
            quotes,
            now
        );
        if (closed.blocked || !closed.account) {
            const blockedAttempt: ChallengeAttempt = {
                ...attempt,
                status: "PAUSED",
                updatedAt: now,
                pausedAt: now,
                settleBlockedReason: closed.blocked ?? "STALE_MARKET_DATA",
            };
            const transition = applyTransition({
                attemptId: attempt.id,
                from: attempt.status,
                to: "PAUSED",
                timestamp: now,
                reason: "Settlement paused: market data unavailable to close open positions safely.",
                eventId: nextEventId("evt"),
                actor: "system",
            });
            if (transition.changed) await store.saveAttempt(blockedAttempt);
            if (transition.event) await persistEvent(uid, transition.event);
            return { settled: false, verdict: { action: "blocked", reasonCode: closed.blocked ?? "STALE_MARKET_DATA", reason: "Market data unavailable — settlement paused (fail-closed)." }, attempt: blockedAttempt };
        }
        openTrades = [];
        closedTrades = [...closedTrades, ...(closed.trades ?? [])];
        account = closed.account;
        metrics = buildMetrics({ attempt, account, openTrades: [], closedTrades, marks: [], quoteAt: now, now, equityCurve: await store.listEquityCurve(uid, attempt.id) });
    }

    // CAS gate — only one caller may settle.
    const committed = await store.casAttemptStatus(uid, attempt.id, ["ACTIVE", "PAUSED"], verdict.status);
    if (!committed) {
        const fresh = await store.getAttempt(uid, attempt.id);
        return { settled: false, verdict: { action: "none" }, attempt: fresh ?? attempt };
    }

    const settledAttempt: ChallengeAttempt = {
        ...attempt,
        status: verdict.status,
        updatedAt: now,
        settledAt: now,
        settleBlockedReason: undefined,
    };

    const dailyPnl = dailyPnlSeries({ attempt: settledAttempt, closedTrades, finalEquityCents: metrics.equityCents });
    const result = buildChallengeResult({
        attempt: settledAttempt,
        policy: attempt.policy,
        metrics,
        closedTrades,
        status: verdict.status,
        reasonCode: verdict.reasonCode,
        reason: verdict.reason,
        dailyPnl,
        now,
        ruleBreachCount: opts.ruleBreachCount,
    });

    settledAttempt.result = result;
    await store.saveAttempt(settledAttempt);
    await store.saveResult(uid, result);

    await persistEvent(uid, {
        eventId: nextEventId("evt"),
        attemptId: attempt.id,
        type: "SETTLEMENT",
        severity: verdict.status === "PASSED" ? "info" : "critical",
        message: `${verdict.status}: ${verdict.reason}`,
        payload: { reasonCode: verdict.reasonCode, status: verdict.status },
        timestamp: now,
    });

    await recordRewards(uid, settledAttempt, result, now);

    await store.bumpAnalytics(store.dayKeyNow(now), {
        challengeCompletions: 1,
        ...(verdict.status === "PASSED" ? { passes: 1 } : {}),
        ...(verdict.status === "FAILED" ? { failures: 1 } : {}),
        ...(verdict.status === "EXPIRED" ? { expiries: 1 } : {}),
        ...(verdict.status === "CANCELLED" ? { cancellations: 1 } : {}),
    });

    await refreshProfile(uid, now);
    await refreshLeaderboardIndex(settledAttempt, result, now);

    return { settled: true, verdict, attempt: settledAttempt, result: await buildReport(uid, settledAttempt.id) ?? undefined };
}

async function recordRewards(uid: string, attempt: ChallengeAttempt, result: ChallengeResult, now: number): Promise<void> {
    if (!isPlatformRewardsEnabled()) return;
    const policy = (await store.getRewardPolicy(attempt.rewardPolicyId)) ?? null;
    if (!policy) return; // Fail-closed: missing reward policy ⇒ no rewards (never guess).

    const status = attempt.status;
    const triggers: Array<"CHALLENGE_PASSED" | "CHALLENGE_COMPLETED"> = [];
    if (status === "PASSED") triggers.push("CHALLENGE_PASSED", "CHALLENGE_COMPLETED");
    else if (status === "FAILED" || status === "EXPIRED") triggers.push("CHALLENGE_COMPLETED");

    let wallet = (await store.getWallet(uid)) ?? emptyWallet(uid, now);
    let grantedPoints = 0;
    let grantedCount = 0;

    for (const trigger of triggers) {
        const plan = planRewards({
            userId: uid,
            trigger,
            policy,
            sourceType: "CHALLENGE_RESULT",
            sourceId: attempt.id,
            now,
            metadata: { attemptId: attempt.id, definitionKey: attempt.definitionKey, status },
            consistencyAchieved: result.consistencyPassed,
        });
        for (const entry of plan.entries) {
            const created = await store.writeLedgerEntry(entry);
            if (created) {
                wallet = applyRewardToWallet(wallet, entry, now);
                grantedCount += 1;
                if (entry.rewardType === "PLATFORM_POINTS" && entry.amount > 0) grantedPoints += entry.amount;
            }
        }
    }

    if (grantedCount > 0) {
        await store.saveWallet(wallet);
        await store.bumpAnalytics(store.dayKeyNow(now), { rewardsGranted: grantedCount, pointsIssued: grantedPoints });
        await persistEvent(uid, {
            eventId: nextEventId("evt"),
            attemptId: attempt.id,
            type: "REWARD_GRANTED",
            severity: "info",
            message: `${grantedCount} platform reward(s) granted (idempotent ledger). ${ARENA_DISCLAIMERS.rewards}`,
            payload: { grantedCount, grantedPoints },
            timestamp: now,
        });
    }
}

// ──────────── State fetch (dashboard) ────────────────────────────────────────

export interface AttemptState {
    attempt: ChallengeAttempt;
    account: VirtualAccount;
    metrics: ChallengeMetrics;
    openPositions: MarkedTrade[];
    recentTrades: ChallengeTrade[];
    recentEvents: ChallengeEvent[];
    guardian: GuardianInsight[];
    requirements: PassRequirement[];
    report: PerformanceReport | null;
    eligibility: ReturnType<typeof evaluateRewardEligibility>;
    quoteProvider: string | null;
    pendingOrders: ChallengePendingOrder[];
    updatedAt: number;
}

async function maybeResume(uid: string, attempt: ChallengeAttempt, now: number): Promise<ChallengeAttempt> {
    if (attempt.status !== "PAUSED") return attempt;
    if (attempt.settleBlockedReason === "STALE_MARKET_DATA") {
        // Resume automatically once fresh quotes resolve for open and pending symbols.
        const open = (await store.listTrades(uid, attempt.id)).filter((t) => t.status === "open");
        const pending = (await store.listPendingOrders(uid, attempt.id)).filter((order) => order.status === "pending" || order.status === "processing");
        const quotes = await resolveQuotes([...open.map((trade) => trade.symbol), ...pending.map((order) => order.symbol)]);
        const symbols = [...open.map((trade) => trade.symbol), ...pending.map((order) => order.symbol)];
        const allFresh = symbols.length === 0 || symbols.every((symbol) => {
            const q = quotes.get(symbol);
            return q && q.timestamp <= now + 5_000 && now - q.timestamp <= FRESH_QUOTE_MS;
        });
        if (!allFresh) return attempt;
    } else if (attempt.pausedAt && dayKeyOf(attempt.pausedAt) === dayKeyOf(now)) {
        return attempt; // daily-loss pause lasts the trading day
    }

    const transition = applyTransition({
        attemptId: attempt.id,
        from: attempt.status,
        to: "ACTIVE",
        timestamp: now,
        reason: attempt.settleBlockedReason === "STALE_MARKET_DATA" ? "Fresh market data restored." : "New trading day — daily pause lifted.",
        eventId: nextEventId("evt"),
        actor: "system",
    });
    if (!transition.changed) return attempt;
    const resumed: ChallengeAttempt = { ...attempt, status: "ACTIVE", updatedAt: now, settleBlockedReason: undefined, pausedAt: undefined };
    await store.saveAttempt(resumed);
    if (transition.event) await persistEvent(uid, transition.event);
    return resumed;
}

export async function getAttemptState(uid: string, attemptId: string): Promise<AttemptState> {
    const now = Date.now();
    let attempt = await store.getAttempt(uid, attemptId);
    if (!attempt) throw new ArenaError(404, "ATTEMPT_NOT_FOUND", "Challenge attempt not found.");

    const account = await store.getAccount(uid, attemptId);
    if (!account) throw new ArenaError(500, "ACCOUNT_MISSING", "Virtual account missing — contact support.");

    let trades = await store.listTrades(uid, attemptId);
    let openTrades = trades.filter((t) => t.status === "open");
    const closedTrades = trades.filter((t) => t.status === "closed");
    const equityCurve = await store.listEquityCurve(uid, attemptId);

    attempt = await maybeResume(uid, attempt, now);

    // ── Terminal state: report only, no re-evaluation ───────────────────────
    if (isTerminalStatus(attempt.status)) {
        const metrics = buildMetrics({
            attempt,
            account,
            openTrades: [],
            closedTrades,
            marks: [],
            quoteAt: account.lastQuoteAt,
            now,
            equityCurve,
        });
        const report = await buildReport(uid, attemptId);
        return {
            attempt,
            account,
            metrics,
            openPositions: [],
            recentTrades: trades.slice(-25).reverse(),
            recentEvents: await store.listEvents(uid, attemptId, 50),
            guardian: [],
            requirements: passRequirements({ policy: attempt.policy, metrics, openPositionCount: 0 }),
            report,
            eligibility: evaluateRewardEligibility({
                country: null,
                program: attempt.definitionKey,
                rewardType: "PLATFORM_POINTS",
                productRuleSatisfied: attempt.status === "PASSED",
                productRuleReason: attempt.status === "PASSED" ? undefined : `Challenge ${attempt.status}.`,
            }),
            quoteProvider: null,
            pendingOrders: await store.listPendingOrders(uid, attemptId),
            updatedAt: now,
        };
    }

    // ── Live evaluation ─────────────────────────────────────────────────────
    // 1. Protective triggers: SL/TP hits close server-side at the trigger level.
    const preQuotes = await resolveQuotes(openTrades.map((t) => t.symbol));
    const freshProtectiveQuotes = new Map(Array.from(preQuotes.entries()).filter(([, quote]) => quote.timestamp <= now + 5_000 && now - quote.timestamp <= FRESH_QUOTE_MS));
    const triggered = await triggerProtectiveOrders(uid, attempt, openTrades, freshProtectiveQuotes, now);
    let liveAccount = account;
    if (triggered.closedAny) {
        trades = await store.listTrades(uid, attemptId);
        openTrades = trades.filter((t) => t.status === "open");
        liveAccount = (await store.getAccount(uid, attemptId)) ?? account;
    }

    // 2. Mark-to-market. If an open instrument has no fresh server quote,
    // pause entries and management until the feed recovers; never present a
    // stale mark as current or settle a challenge against missing data.
    let { account: marked, marks, quoteAt, quotes } = await markAccountToMarket(uid, attempt, liveAccount, openTrades, now);
    const staleSymbols = openTrades.filter((trade) => {
        const quote = quotes.get(trade.symbol);
        return !quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS;
    }).map((trade) => trade.symbol);
    if (staleSymbols.length > 0 && attempt.status === "ACTIVE") {
        await pauseForStaleData(uid, attempt, now, staleSymbols.join(", "));
        attempt = { ...attempt, status: "PAUSED", pausedAt: now, settleBlockedReason: "STALE_MARKET_DATA" };
    }
    const pendingOrders = await store.listPendingOrders(uid, attemptId);
    const filledPendingOrder = await processPendingOrders(uid, attempt, pendingOrders, quotes, now);
    if (filledPendingOrder) {
        attempt = (await store.getAttempt(uid, attemptId)) ?? attempt;
        trades = await store.listTrades(uid, attemptId);
        openTrades = trades.filter((trade) => trade.status === "open");
        liveAccount = (await store.getAccount(uid, attemptId)) ?? marked;
        const refreshed = await markAccountToMarket(uid, attempt, liveAccount, openTrades, now);
        marked = refreshed.account;
        marks = refreshed.marks;
        quoteAt = refreshed.quoteAt;
        quotes = refreshed.quotes;
    }
    const metrics = buildMetrics({ attempt, account: marked, openTrades, closedTrades, marks, quoteAt, now, equityCurve });

    // Persist an equity point at most once a minute (curve for report/DD).
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (!lastPoint || now - lastPoint.t >= EQUITY_POINT_MIN_GAP_MS) {
        await store.appendEquityPoint(uid, attemptId, { t: now, equityCents: metrics.equityCents });
        equityCurve.push({ t: now, equityCents: metrics.equityCents });
        metrics.equityCurve = equityCurve;
    }

    // Rule evaluation (BREACH only on fresh data — engine enforces this).
    const ruleCtx = makeRuleContext(attempt, attempt.policy, metrics, now);
    const ruleEvents = evaluateAccountRules(ruleCtx);
    // persistRuleEvents derives deterministic per-hour ids → repeats collapse.
    await persistRuleEvents(uid, attemptId, ruleEvents, now);

    const breaches = ruleEvents.filter((e) => e.severity === "BREACH").map((e) => e.type);
    const dailyPnl = dailyPnlSeries({ attempt, closedTrades, finalEquityCents: metrics.equityCents });

    // Settlement evaluation (may transition + grant rewards).
    const verdict = evaluateSettlement({
        attempt,
        policy: attempt.policy,
        metrics,
        closedTrades,
        openPositionCount: openTrades.length,
        now,
        breachTypes: breaches,
        dailyPnl,
    });

    if (verdict.action === "settle") {
        const outcome = await settleAttempt(uid, attempt, verdict, {
            now,
            openTrades,
            closedTrades,
            account: marked,
            metrics,
            ruleBreachCount: breaches.length,
        });
        if (outcome.settled) return getAttemptState(uid, attemptId);
        if (outcome.attempt.status === "PAUSED") attempt = outcome.attempt;
    } else if (verdict.action === "blocked" && verdict.reasonCode === "DAILY_LOSS_PAUSE") {
        const transition = applyTransition({
            attemptId,
            from: attempt.status,
            to: "PAUSED",
            timestamp: now,
            reason: verdict.reason,
            eventId: nextEventId("evt"),
            actor: "system",
        });
        if (transition.changed) {
            const paused: ChallengeAttempt = {
                ...attempt,
                status: "PAUSED",
                updatedAt: now,
                pausedAt: now,
                settleBlockedReason: "DAILY_LOSS_PAUSE",
            };
            await store.saveAttempt(paused);
            if (transition.event) await persistEvent(uid, transition.event);
            attempt = paused;
        }
    }

    // Refresh the leaderboard index (throttled) so rankings track live runs.
    await maybeRefreshLeaderboardIndex(uid, attempt, metrics, now);

    const guardianInput: GuardianInput = {
        attemptId,
        policy: attempt.policy,
        metrics,
        openTrades,
        closedTrades,
        now,
        nextInsightId: () => nextEventId("ins"),
    };
    const guardian = buildGuardianInsights(guardianInput);

    const provider = quotes.size > 0 ? Array.from(quotes.values())[0]?.provider ?? null : null;
    trades = await store.listTrades(uid, attemptId);

    return {
        attempt,
        account: marked,
        metrics,
        openPositions: openTrades.map<MarkedTrade>((trade) => {
            const mark = marks.find((m) => m.tradeId === trade.tradeId);
            return {
                trade,
                markPriceMicros: mark?.markPriceMicros ?? null,
                unrealizedPnLCents: mark?.unrealizedPnLCents ?? 0,
                quoteAt: mark?.quoteAt ?? null,
                stale: !mark || mark.markPriceMicros === null,
            };
        }),
        recentTrades: trades.slice(-25).reverse(),
        recentEvents: await store.listEvents(uid, attemptId, 50),
        guardian,
        requirements: passRequirements({ policy: attempt.policy, metrics, openPositionCount: openTrades.length }),
        report: null,
        eligibility: evaluateRewardEligibility({
            country: null,
            program: attempt.definitionKey,
            rewardType: "PLATFORM_POINTS",
            productRuleSatisfied: metrics.totalReturnPct >= attempt.policy.profitTargetPct,
            productRuleReason: "Profit target not yet reached.",
        }),
        quoteProvider: provider,
        pendingOrders: await store.listPendingOrders(uid, attemptId),
        updatedAt: now,
    };
}

// ──────────── Orders ─────────────────────────────────────────────────────────

export interface PlaceOrderInput {
    symbol: string;
    side: "long" | "short";
    sizeLots: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    entryPrice?: number | null;
    orderType?: "market" | "limit" | "stop";
    clientRequestId?: string;
}

export interface PlaceOrderResult {
    trade: ChallengeTrade | null;
    duplicate: boolean;
    state: AttemptState;
}

export async function placeOrder(uid: string, attemptId: string, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const now = Date.now();
    const rate = await store.bumpApiActivity(uid, now);

    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt) throw new ArenaError(404, "ATTEMPT_NOT_FOUND", "Challenge attempt not found.");
    if (attempt.status !== "ACTIVE") throw new ArenaError(409, "NOT_ACTIVE", `Challenge is ${attempt.status} — new orders require an active attempt.`);

    // Idempotent replay of a submitted order.
    const orderType = input.orderType ?? "market";
    if (input.clientRequestId) {
        const existingTrade = await store.findTradeByClientRequestId(uid, attemptId, input.clientRequestId);
        if (existingTrade) return { trade: existingTrade, duplicate: true, state: await getAttemptState(uid, attemptId) };
        const existingPending = await store.findPendingOrderByClientRequestId(uid, attemptId, input.clientRequestId);
        if (existingPending) return { trade: null, duplicate: true, state: await getAttemptState(uid, attemptId) };
    }
    if (orderType !== "market") {
        if (input.entryPrice == null || !Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
            throw new ArenaError(400, "INVALID_ENTRY", "Limit and stop orders require a positive entry price.");
        }
        return createPendingOrder(uid, attemptId, input, orderType, now);
    }

    const account = await store.getAccount(uid, attemptId);
    if (!account) throw new ArenaError(500, "ACCOUNT_MISSING", "Virtual account missing.");

    const trades = await store.listTrades(uid, attemptId);
    const openTrades = trades.filter((t) => t.status === "open");
    const closedTrades = trades.filter((t) => t.status === "closed");

    const { account: marked, marks, quoteAt } = await markAccountToMarket(uid, attempt, account, openTrades, now);
    const metrics = buildMetrics({ attempt, account: marked, openTrades, closedTrades, marks, quoteAt, now, equityCurve: [] });

    const normalizedSymbol = normalizeArenaSymbol(input.symbol);
    const spec = arenaSymbolSpec(normalizedSymbol);
    if (!spec || !MARKET_DATA_SYMBOLS.has(spec.symbol)) {
        throw new ArenaError(400, "UNKNOWN_SYMBOL", `No configured market-data and execution instrument is available for ${input.symbol}.`);
    }
    if (!attempt.policy.allowedMarkets.includes(spec.market) || (attempt.policy.allowedSymbols !== "all" && !attempt.policy.allowedSymbols.some((allowed) => normalizeArenaSymbol(allowed) === spec.symbol))) {
        throw new ArenaError(422, "RULE_VIOLATION", `${spec.symbol} is not included in this challenge's allowed markets/symbols.`);
    }

    const centiLots = Math.round(input.sizeLots * 100);
    if (!Number.isFinite(input.sizeLots) || !Number.isSafeInteger(centiLots) || centiLots <= 0) {
        throw new ArenaError(400, "INVALID_SIZE", "Position size must be a positive number of lots.");
    }
    const maxSize = Math.min(attempt.policy.positionSizePolicy.maxSizeLots, spec.maxLot);
    const minSize = Math.max(spec.minLot, attempt.policy.positionSizePolicy.stepLots);
    if (input.sizeLots < minSize || input.sizeLots > maxSize || Math.abs(input.sizeLots * 100 - centiLots) > 1e-7 || Math.abs(input.sizeLots / attempt.policy.positionSizePolicy.stepLots - Math.round(input.sizeLots / attempt.policy.positionSizePolicy.stepLots)) > 1e-7) {
        throw new ArenaError(400, "INVALID_SIZE", `Size must be at least ${minSize} lots in ${attempt.policy.positionSizePolicy.stepLots}-lot increments and no greater than ${maxSize} lots for ${spec.symbol}.`);
    }

    const quote = await resolveQuote(spec.symbol);
    if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) {
        // Fail-closed: never fill against missing/stale prices.
        if (openTrades.length > 0) await pauseForStaleData(uid, attempt, now, spec.symbol);
        throw new ArenaError(503, "MARKET_DATA_UNAVAILABLE", "Live market data is unavailable — order rejected (fail-closed).");
    }

    const stopLossMicros = input.stopLoss != null ? toPriceMicros(input.stopLoss) : null;
    const takeProfitMicros = input.takeProfit != null ? toPriceMicros(input.takeProfit) : null;
    if (input.stopLoss != null && (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0)) {
        throw new ArenaError(400, "INVALID_STOP", "Stop-loss must be a positive finite price.");
    }
    if (input.takeProfit != null && (!Number.isFinite(input.takeProfit) || input.takeProfit <= 0)) {
        throw new ArenaError(400, "INVALID_TP", "Take-profit must be a positive finite price.");
    }
    if (stopLossMicros !== null) {
        const wrongSide = input.side === "long" ? stopLossMicros >= quotePriceMicros(quote.price) : stopLossMicros <= quotePriceMicros(quote.price);
        if (wrongSide) throw new ArenaError(400, "INVALID_STOP", "Stop-loss is on the wrong side of the current price.");
    }
    if (takeProfitMicros !== null) {
        const wrongSide = input.side === "long" ? takeProfitMicros <= quotePriceMicros(quote.price) : takeProfitMicros >= quotePriceMicros(quote.price);
        if (wrongSide) throw new ArenaError(400, "INVALID_TP", "Take-profit is on the wrong side of the current price.");
    }

    const fill = computeFill({ side: input.side, sizeCentiLots: centiLots, quotePrice: quote.price, spec, policy: attempt.policy });
    const riskCents = fill.riskCents(stopLossMicros);
    const session = getCurrentSession(new Date(now)).current;

    const preTrade = evaluatePreTrade({
        attempt,
        policy: attempt.policy,
        metrics,
        now,
        symbol: spec.symbol,
        sizeCentiLots: centiLots,
        stopLossMicros,
        notionalCents: fill.notionalCents,
        riskCents,
        openPositions: openTrades.length,
        quotePrice: quote.price,
        session: session === "closed" ? null : session,
        marketOpen: spec.market === "crypto" ? true : isMarketOpen(new Date(now)),
        nextEventId: () => nextEventId("rule"),
    });

    if (!preTrade.ok) {
        const summary = preTrade.violations.map((v) => v.message).join(" ");
        await persistEvent(uid, {
            eventId: nextEventId("evt"),
            attemptId,
            type: "ORDER_REJECTED",
            severity: "warning",
            message: `Order rejected: ${summary}`,
            payload: { symbol: spec.symbol, side: input.side, sizeLots: input.sizeLots, violations: preTrade.violations.map((v) => v.ruleId) },
            timestamp: now,
        });
        await persistRuleEvents(uid, attemptId, preTrade.violations, now);
        throw new ArenaError(422, "RULE_VIOLATION", summary, preTrade.violations);
    }

    if (preTrade.advisories.length > 0) await persistRuleEvents(uid, attemptId, preTrade.advisories, now);

    // Impossible-execution guard (server-verified fill vs resolved quote).
    const execCtx: FraudDetectionContext = { userId: uid, attempt, now, recentAttempts: [], nextFlagId: () => nextEventId("ff") };
    for (const flag of detectImpossibleExecution({
        ctx: execCtx,
        quotePriceMicros: quotePriceMicros(quote.price),
        fillPriceMicros: fill.entryPriceMicros,
        symbol: spec.symbol,
    })) {
        await store.writeFraudFlag(flag);
    }

    const trade: ChallengeTrade = {
        tradeId: input.clientRequestId ? store.rtdbKey(`trade_${input.clientRequestId}`) : store.newArenaId("trd"),
        attemptId,
        userId: uid,
        symbol: spec.symbol,
        market: spec.market,
        side: input.side,
        sizeCentiLots: centiLots,
        entryPriceMicros: fill.entryPriceMicros,
        entryAt: now,
        entryQuoteAt: quote.timestamp,
        costs: fill.costs,
        stopLossMicros,
        takeProfitMicros,
        riskCents,
        status: "open",
        closedAt: null,
        exitPriceMicros: null,
        exitQuoteAt: null,
        exitReason: null,
        realizedPnLCents: null,
        clientRequestId: input.clientRequestId ?? null,
        updatedAt: now,
    };
    const savedTrade = await store.createTradeIfAbsent(trade);
    if (!savedTrade.created) return { trade: savedTrade.trade, duplicate: true, state: await getAttemptState(uid, attemptId) };

    // Trading-day / daily-trade accounting.
    const dayKey = dayKeyOf(now);
    const updatedAttempt: ChallengeAttempt = {
        ...attempt,
        tradingDayKeys: { ...attempt.tradingDayKeys, [dayKey]: attempt.tradingDayKeys[dayKey] ?? now },
        dailyTradeCounts: { ...attempt.dailyTradeCounts, [dayKey]: (attempt.dailyTradeCounts[dayKey] ?? 0) + 1 },
        updatedAt: now,
    };
    await store.saveAttempt(updatedAttempt);

    const updatedAccount: VirtualAccount = {
        ...marked,
        feesCents: marked.feesCents + fill.totalCostCents,
        exposureCents: marked.exposureCents + fill.notionalCents,
        updatedAt: now,
    };
    await store.saveAccount(updatedAccount);

    await persistEvent(uid, {
        eventId: nextEventId("evt"),
        attemptId,
        type: "TRADE_OPENED",
        severity: "info",
        message: `${spec.symbol} ${input.side} ${input.sizeLots} lot(s) opened at ${quote.price} (virtual). Round-trip cost: $${(fill.totalCostCents / 100).toFixed(2)}.`,
        payload: {
            tradeId: trade.tradeId,
            symbol: spec.symbol,
            side: input.side,
            sizeCentiLots: centiLots,
            entryPriceMicros: fill.entryPriceMicros,
            costs: fill.costs,
            riskCents,
        },
        timestamp: now,
    });

    // Post-entry rule evaluation (exposure/limits/daily-loss proximity).
    const afterTrades = [...trades.filter((t) => t.status === "open"), trade];
    const postMetrics = buildMetrics({
        attempt: updatedAttempt,
        account: updatedAccount,
        openTrades: afterTrades,
        closedTrades,
        marks: [...marks, { tradeId: trade.tradeId, unrealizedPnLCents: -fill.totalCostCents, markPriceMicros: fill.entryPriceMicros, quoteAt: quote.timestamp }],
        quoteAt: quote.timestamp,
        now,
        equityCurve: [],
    });
    const postEvents = evaluateAccountRules(makeRuleContext(updatedAttempt, updatedAttempt.policy, postMetrics, now));
    await persistRuleEvents(uid, attemptId, postEvents, now);

    // Abuse rate flag (after recording the legitimate action).
    const fraudCtx: FraudDetectionContext = {
        userId: uid,
        attempt: updatedAttempt,
        now,
        recentAttempts: [],
        apiCallsThisMinute: rate,
        nextFlagId: () => nextEventId("ff"),
    };
    for (const flag of runFraudDetections({ ctx: fraudCtx })) await store.writeFraudFlag(flag);

    return { trade, duplicate: false, state: await getAttemptState(uid, attemptId) };
}

async function createPendingOrder(uid: string, attemptId: string, input: PlaceOrderInput, orderType: "limit" | "stop", now: number): Promise<PlaceOrderResult> {
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt || attempt.status !== "ACTIVE") throw new ArenaError(409, "NOT_ACTIVE", `Challenge is ${attempt?.status ?? "missing"} — pending orders require an active attempt.`);
    const symbol = normalizeArenaSymbol(input.symbol);
    const spec = arenaSymbolSpec(symbol);
    if (!spec || !MARKET_DATA_SYMBOLS.has(spec.symbol)) throw new ArenaError(400, "UNKNOWN_SYMBOL", `No configured market-data and execution instrument is available for ${input.symbol}.`);
    if (!attempt.policy.allowedMarkets.includes(spec.market) || (attempt.policy.allowedSymbols !== "all" && !attempt.policy.allowedSymbols.some((allowed) => normalizeArenaSymbol(allowed) === spec.symbol))) {
        throw new ArenaError(422, "RULE_VIOLATION", `${spec.symbol} is not included in this challenge's allowed markets/symbols.`);
    }
    const lots = input.sizeLots;
    const centiLots = Math.round(lots * 100);
    const minLots = Math.max(spec.minLot, attempt.policy.positionSizePolicy.stepLots);
    const maxLots = Math.min(attempt.policy.positionSizePolicy.maxSizeLots, spec.maxLot);
    if (!Number.isFinite(lots) || lots < minLots || lots > maxLots || !Number.isSafeInteger(centiLots) || Math.abs(lots * 100 - centiLots) > 1e-7 || Math.abs(lots / attempt.policy.positionSizePolicy.stepLots - Math.round(lots / attempt.policy.positionSizePolicy.stepLots)) > 1e-7) {
        throw new ArenaError(400, "INVALID_SIZE", `Size must be at least ${minLots} lots in ${attempt.policy.positionSizePolicy.stepLots}-lot increments and no greater than ${maxLots} lots for ${spec.symbol}.`);
    }
    if (input.stopLoss != null && (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0)) throw new ArenaError(400, "INVALID_STOP", "Stop-loss must be a positive finite price.");
    if (input.takeProfit != null && (!Number.isFinite(input.takeProfit) || input.takeProfit <= 0)) throw new ArenaError(400, "INVALID_TP", "Take-profit must be a positive finite price.");
    const quote = await resolveQuote(spec.symbol);
    if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) throw new ArenaError(503, "MARKET_DATA_UNAVAILABLE", "Current market data is unavailable; pending order placement requires a fresh quote.");
    const entryPriceMicros = toPriceMicros(input.entryPrice!);
    const currentPriceMicros = toPriceMicros(quote.price);
    const validGeometry = orderType === "limit"
        ? input.side === "long" ? entryPriceMicros < currentPriceMicros : entryPriceMicros > currentPriceMicros
        : input.side === "long" ? entryPriceMicros > currentPriceMicros : entryPriceMicros < currentPriceMicros;
    if (!validGeometry) throw new ArenaError(400, "INVALID_ENTRY", `${orderType} entry price is on the wrong side of the current market.`);
    const stopLossMicros = input.stopLoss == null ? null : toPriceMicros(input.stopLoss);
    const takeProfitMicros = input.takeProfit == null ? null : toPriceMicros(input.takeProfit);
    const reference = computeFill({ side: input.side, sizeCentiLots: centiLots, quotePrice: input.entryPrice!, spec, policy: attempt.policy });
    const riskCents = reference.riskCents(stopLossMicros);
    if (stopLossMicros !== null && (input.side === "long" ? stopLossMicros >= entryPriceMicros : stopLossMicros <= entryPriceMicros)) throw new ArenaError(400, "INVALID_STOP", "Stop-loss is on the wrong side of the pending entry.");
    if (takeProfitMicros !== null && (input.side === "long" ? takeProfitMicros <= entryPriceMicros : takeProfitMicros >= entryPriceMicros)) throw new ArenaError(400, "INVALID_TP", "Take-profit is on the wrong side of the pending entry.");
    const account = await store.getAccount(uid, attemptId);
    if (!account) throw new ArenaError(500, "ACCOUNT_MISSING", "Virtual account missing.");
    const trades = await store.listTrades(uid, attemptId);
    const openTrades = trades.filter((trade) => trade.status === "open");
    const { account: marked, marks, quoteAt } = await markAccountToMarket(uid, attempt, account, openTrades, now);
    const metrics = buildMetrics({ attempt, account: marked, openTrades, closedTrades: trades.filter((trade) => trade.status === "closed"), marks, quoteAt, now, equityCurve: [] });
    const session = getCurrentSession(new Date(now)).current;
    const preTrade = evaluatePreTrade({
        attempt, policy: attempt.policy, metrics, now, symbol: spec.symbol, sizeCentiLots: centiLots,
        stopLossMicros, notionalCents: reference.notionalCents, riskCents, openPositions: openTrades.length,
        quotePrice: input.entryPrice!, session: session === "closed" ? null : session,
        marketOpen: spec.market === "crypto" ? true : isMarketOpen(new Date(now)), nextEventId: () => nextEventId("rule"),
    });
    if (!preTrade.ok) {
        await persistEvent(uid, {
            eventId: nextEventId("evt"), attemptId, type: "ORDER_REJECTED", severity: "warning",
            message: `Pending order rejected: ${preTrade.violations.map((event) => event.message).join(" ")}`,
            payload: { symbol: spec.symbol, side: input.side, sizeLots: lots, violations: preTrade.violations.map((event) => event.ruleId) }, timestamp: now,
        });
        await persistRuleEvents(uid, attemptId, preTrade.violations, now);
        throw new ArenaError(422, "RULE_VIOLATION", preTrade.violations.map((event) => event.message).join(" "), preTrade.violations);
    }
    if (preTrade.advisories.length > 0) await persistRuleEvents(uid, attemptId, preTrade.advisories, now);
    const pendingOrder: ChallengePendingOrder = {
        orderId: store.newArenaId("ord"), attemptId, userId: uid, symbol: spec.symbol, market: spec.market, side: input.side,
        orderType, sizeCentiLots: centiLots, entryPriceMicros, stopLossMicros, takeProfitMicros, createdAt: now,
        expiresAt: Math.min(now + 7 * 24 * 60 * 60 * 1000, attempt.expiresAt), status: "pending",
        clientRequestId: input.clientRequestId ?? null, filledTradeId: null,
    };
    await store.savePendingOrder(pendingOrder);
    await persistEvent(uid, {
        eventId: nextEventId("evt"), attemptId, type: "PENDING_ORDER_PLACED", severity: "info",
        message: `${spec.symbol} ${input.side} ${orderType} simulated order placed at ${input.entryPrice}.`,
        payload: { orderId: pendingOrder.orderId, symbol: spec.symbol, side: input.side, orderType, entryPriceMicros }, timestamp: now,
    });
    return { trade: null, duplicate: false, state: await getAttemptState(uid, attemptId) };
}

async function processPendingOrders(uid: string, attempt: ChallengeAttempt, orders: ChallengePendingOrder[], quotes: Map<string, ArenaQuote>, now: number): Promise<boolean> {
    if (attempt.status !== "ACTIVE") return false;
    let filledAny = false;
    for (const order of orders) {
        if (order.status !== "pending" && order.status !== "processing") continue;
        const claim = await store.claimPendingOrder(uid, attempt.id, order.orderId, now);
        if (!claim) continue;
        if (claim.status === "expired") {
            await persistEvent(uid, { eventId: `evt_pending_expire_${store.rtdbKey(order.orderId)}`, attemptId: attempt.id, type: "PENDING_ORDER_CANCELLED", severity: "info", message: `${order.symbol} pending order expired.`, payload: { orderId: order.orderId }, timestamp: now });
            continue;
        }
        try {
            if (claim.filledTrade) {
                const committed = await store.commitPendingFill({ uid, attemptId: attempt.id, order: claim, trade: claim.filledTrade, now });
                filledAny ||= committed;
                if (committed) break;
                continue;
            }
            const quote = quotes.get(claim.symbol) ?? await resolveQuote(claim.symbol);
            if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) {
                await store.releasePendingOrderClaim(uid, attempt.id, claim.orderId, claim.processingAt ?? now);
                continue;
            }
            const orderPrice = claim.entryPriceMicros / 1_000_000;
            const marketPrice = quote.price;
            const triggered = claim.orderType === "limit"
                ? claim.side === "long" ? marketPrice <= orderPrice : marketPrice >= orderPrice
                : claim.side === "long" ? marketPrice >= orderPrice : marketPrice <= orderPrice;
            if (!triggered) {
                await store.releasePendingOrderClaim(uid, attempt.id, claim.orderId, claim.processingAt ?? now);
                continue;
            }
            const trades = await store.listTrades(uid, attempt.id);
            const account = await store.getAccount(uid, attempt.id);
            if (!account) throw new ArenaError(500, "ACCOUNT_MISSING", "Virtual account missing.");
            const openTrades = trades.filter((trade) => trade.status === "open");
            const closedTrades = trades.filter((trade) => trade.status === "closed");
            const { account: marked, marks, quoteAt } = await markAccountToMarket(uid, attempt, account, openTrades, now);
            const metrics = buildMetrics({ attempt, account: marked, openTrades, closedTrades, marks, quoteAt, now, equityCurve: [] });
            const spec = arenaSymbolSpec(claim.symbol)!;
            const fill = computeFill({ side: claim.side, sizeCentiLots: claim.sizeCentiLots, quotePrice: marketPrice, spec, policy: attempt.policy });
            const riskCents = fill.riskCents(claim.stopLossMicros);
            const candidateTradeId = claim.filledTradeId ?? store.rtdbKey(`pending-fill_${claim.orderId}`);
            const candidateTrade: ChallengeTrade = {
                tradeId: candidateTradeId, attemptId: attempt.id, userId: uid, symbol: claim.symbol, market: claim.market, side: claim.side,
                sizeCentiLots: claim.sizeCentiLots, entryPriceMicros: fill.entryPriceMicros, entryAt: now,
                entryQuoteAt: quote.timestamp, costs: fill.costs, stopLossMicros: claim.stopLossMicros,
                takeProfitMicros: claim.takeProfitMicros, riskCents, status: "open", closedAt: null, exitPriceMicros: null,
                exitQuoteAt: null, exitReason: null, realizedPnLCents: null, clientRequestId: claim.clientRequestId, updatedAt: now,
            };
            const stopsFitFill =
                (claim.stopLossMicros === null || (claim.side === "long" ? claim.stopLossMicros < fill.entryPriceMicros : claim.stopLossMicros > fill.entryPriceMicros)) &&
                (claim.takeProfitMicros === null || (claim.side === "long" ? claim.takeProfitMicros > fill.entryPriceMicros : claim.takeProfitMicros < fill.entryPriceMicros));
            const session = getCurrentSession(new Date(now)).current;
            const preTrade = evaluatePreTrade({
                attempt, policy: attempt.policy, metrics, now, symbol: claim.symbol, sizeCentiLots: claim.sizeCentiLots,
                stopLossMicros: claim.stopLossMicros, notionalCents: fill.notionalCents, riskCents,
                openPositions: openTrades.length, quotePrice: marketPrice, session: session === "closed" ? null : session,
                marketOpen: spec.market === "crypto" ? true : isMarketOpen(new Date(now)), nextEventId: () => nextEventId("rule"),
            });
            if (preTrade.advisories.length > 0) await persistRuleEvents(uid, attempt.id, preTrade.advisories, now);
            if (!preTrade.ok || !stopsFitFill) {
                const reasons = preTrade.violations.map((event) => event.message);
                if (!stopsFitFill) reasons.push("The market gapped through the pending fill so its stop/target would be invalid.");
                await store.savePendingOrder({ ...claim, status: "cancelled" });
                await persistEvent(uid, {
                    eventId: `evt_pending_reject_${store.rtdbKey(claim.orderId)}`, attemptId: attempt.id, type: "ORDER_REJECTED", severity: "warning",
                    message: `Triggered pending order cancelled: ${reasons.join(" ")}`,
                    payload: { orderId: claim.orderId, violations: preTrade.violations.map((event) => event.ruleId), stopsFitFill }, timestamp: now,
                });
                continue;
            }
            const trade = candidateTrade;
            const tradeId = trade.tradeId;
            const committed = await store.commitPendingFill({ uid, attemptId: attempt.id, order: claim, trade, now });
            if (!committed) continue;
            filledAny = true;
            await persistEvent(uid, { eventId: `evt_pending_fill_${store.rtdbKey(claim.orderId)}`, attemptId: attempt.id, type: "TRADE_OPENED", severity: "info", message: `${claim.symbol} ${claim.side} ${claim.orderType} filled at ${marketPrice} (virtual).`, payload: { tradeId, orderId: claim.orderId, entryPriceMicros: fill.entryPriceMicros, costs: fill.costs }, timestamp: now });
            void metrics;
            break;
        } catch (error) {
            if (!claim.filledTrade) await store.releasePendingOrderClaim(uid, attempt.id, claim.orderId, claim.processingAt ?? now);
            throw error;
        }
    }
    return filledAny;
}

function quotePriceMicros(price: number): number {
    return toPriceMicros(price);
}

export async function modifyPositionStops(
    uid: string,
    attemptId: string,
    tradeId: string,
    changes: { stopLoss?: number | null; takeProfit?: number | null }
): Promise<AttemptState> {
    const now = Date.now();
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt || attempt.status !== "ACTIVE") throw new ArenaError(409, "NOT_ACTIVE", "Stops can only be modified on an active challenge.");
    const trade = await store.getTrade(uid, attemptId, tradeId);
    if (!trade || trade.status !== "open") throw new ArenaError(404, "TRADE_NOT_FOUND", "Open position not found.");
    const quote = await resolveQuote(trade.symbol);
    if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) {
        await pauseForStaleData(uid, attempt, now, trade.symbol);
        throw new ArenaError(503, "MARKET_DATA_UNAVAILABLE", "Current quote unavailable; stops were not modified and trading is paused.");
    }
    const current = toPriceMicros(quote.price);
    const stopLossMicros = changes.stopLoss === undefined ? trade.stopLossMicros : changes.stopLoss === null ? null : toPriceMicros(changes.stopLoss);
    const takeProfitMicros = changes.takeProfit === undefined ? trade.takeProfitMicros : changes.takeProfit === null ? null : toPriceMicros(changes.takeProfit);
    if (changes.stopLoss !== undefined && changes.stopLoss !== null && (!Number.isFinite(changes.stopLoss) || changes.stopLoss <= 0)) throw new ArenaError(400, "INVALID_STOP", "Stop-loss must be a positive finite price.");
    if (changes.takeProfit !== undefined && changes.takeProfit !== null && (!Number.isFinite(changes.takeProfit) || changes.takeProfit <= 0)) throw new ArenaError(400, "INVALID_TP", "Take-profit must be a positive finite price.");
    if (stopLossMicros !== null && (trade.side === "long" ? stopLossMicros >= current : stopLossMicros <= current)) throw new ArenaError(400, "INVALID_STOP", "Stop-loss must remain beyond the current quote on the loss side.");
    if (takeProfitMicros !== null && (trade.side === "long" ? takeProfitMicros <= current : takeProfitMicros >= current)) throw new ArenaError(400, "INVALID_TP", "Take-profit must remain beyond the current quote on the profit side.");
    const spec = arenaSymbolSpec(trade.symbol);
    if (!spec) throw new ArenaError(400, "UNKNOWN_SYMBOL", "Execution specification unavailable for this instrument.");
    const riskCents = plannedRiskCents({ side: trade.side, entryPriceMicros: trade.entryPriceMicros, stopLossMicros, sizeCentiLots: trade.sizeCentiLots, contractSize: spec.contractSize, costCents: trade.costs.spreadCostCents + trade.costs.slippageCostCents + trade.costs.commissionCents });
    const modified = await store.modifyTradeStops(uid, attemptId, tradeId, stopLossMicros, takeProfitMicros, riskCents, now);
    if (!modified) throw new ArenaError(409, "POSITION_CHANGED", "Position was closed or changed concurrently; reload and retry.");
    await persistEvent(uid, { eventId: nextEventId("evt"), attemptId, type: "POSITION_MODIFIED", severity: "info", message: `${trade.symbol} stops updated.`, payload: { tradeId, stopLossMicros, takeProfitMicros, riskCents }, timestamp: now });
    return getAttemptState(uid, attemptId);
}

export async function cancelPendingOrder(uid: string, attemptId: string, orderId: string): Promise<AttemptState> {
    const now = Date.now();
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt || (attempt.status !== "ACTIVE" && attempt.status !== "PAUSED")) throw new ArenaError(409, "NOT_ACTIVE", "Pending orders can only be cancelled on a non-terminal challenge.");
    const cancelled = await store.cancelPendingOrderIfPending(uid, attemptId, orderId, now);
    if (!cancelled) throw new ArenaError(409, "ORDER_NOT_PENDING", "Order is no longer pending.");
    await persistEvent(uid, { eventId: `evt_pending_cancel_${store.rtdbKey(orderId)}`, attemptId, type: "PENDING_ORDER_CANCELLED", severity: "info", message: `${cancelled.symbol} pending entry cancelled.`, payload: { orderId }, timestamp: now });
    return getAttemptState(uid, attemptId);
}

export async function closePosition(uid: string, attemptId: string, tradeId: string, clientRequestId?: string): Promise<AttemptState> {
    const now = Date.now();
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt) throw new ArenaError(404, "ATTEMPT_NOT_FOUND", "Challenge attempt not found.");
    if (attempt.status !== "ACTIVE" && attempt.status !== "PAUSED") {
        throw new ArenaError(409, "NOT_ACTIVE", `Challenge is ${attempt.status} — positions are managed by settlement.`);
    }
    if (attempt.status === "PAUSED" && attempt.settleBlockedReason === "STALE_MARKET_DATA") {
        const open = (await store.listTrades(uid, attemptId)).filter((item) => item.status === "open");
        const quotes = await resolveQuotes(open.map((item) => item.symbol));
        if (open.some((item) => {
            const current = quotes.get(item.symbol);
            return !current || current.timestamp > now + 5_000 || now - current.timestamp > FRESH_QUOTE_MS;
        })) {
            throw new ArenaError(503, "MARKET_DATA_UNAVAILABLE", "Market data is stale — position changes are paused until current quotes return.");
        }
    }

    const trade = await store.getTrade(uid, attemptId, tradeId);
    if (!trade) throw new ArenaError(404, "TRADE_NOT_FOUND", "Trade not found.");
    if (trade.status === "closed") {
        // Idempotent close: replaying a close returns the settled state.
        if (clientRequestId && trade.clientRequestId === clientRequestId) return getAttemptState(uid, attemptId);
        return getAttemptState(uid, attemptId);
    }

    const quote = await resolveQuote(trade.symbol);
    if (!quote || quote.timestamp > now + 5_000 || now - quote.timestamp > FRESH_QUOTE_MS) {
        await pauseForStaleData(uid, attempt, now, trade.symbol);
        throw new ArenaError(503, "MARKET_DATA_UNAVAILABLE", "Live market data is unavailable — position paused and close rejected (fail-closed).");
    }

    const spec = arenaSymbolSpec(trade.symbol);
    const contractSize = spec?.contractSize ?? contractSizeOf(trade.symbol);
    const exit = computeExit({
        side: trade.side,
        entryPriceMicros: trade.entryPriceMicros,
        sizeCentiLots: trade.sizeCentiLots,
        contractSize,
        quotePrice: quote.price,
        costs: trade.costs,
    });

    const closedTrade: ChallengeTrade = {
        ...trade,
        status: "closed",
        closedAt: now,
        exitPriceMicros: exit.exitPriceMicros,
        exitQuoteAt: quote.timestamp,
        exitReason: "manual",
        realizedPnLCents: exit.netPnLCents,
    };
    await store.saveTrade(closedTrade);

    const account = await store.getAccount(uid, attemptId);
    if (!account) throw new ArenaError(500, "ACCOUNT_MISSING", "Virtual account missing.");
    const realized = account.realizedPnLCents + exit.netPnLCents;
    const balance = account.startingBalanceCents + realized;
    const equity = balance; // flat after close
    const updated: VirtualAccount = {
        ...account,
        realizedPnLCents: realized,
        balanceCents: balance,
        equityCents: equity,
        unrealizedPnLCents: 0,
        peakEquityCents: Math.max(account.peakEquityCents, equity),
        dailyPnLCcents: equity - account.dayStartEquityCents,
        updatedAt: now,
    };
    // Exposure recomputed from remaining open trades (authoritative).
    const remainingOpen = (await store.listTrades(uid, attemptId)).filter((t) => t.status === "open");
    updated.exposureCents = remainingOpen.reduce((sum, t) => {
        const s = arenaSymbolSpec(t.symbol);
        const cs = s?.contractSize ?? contractSizeOf(t.symbol);
        return sum + Math.round((t.entryPriceMicros / 1_000_000) * (t.sizeCentiLots / 100) * cs * 100);
    }, 0);
    await store.saveAccount(updated);

    await persistEvent(uid, {
        eventId: nextEventId("evt"),
        attemptId,
        type: "TRADE_CLOSED",
        severity: "info",
        message: `${trade.symbol} ${trade.side} closed at ${quote.price} — net ${exit.netPnLCents >= 0 ? "+" : ""}${(exit.netPnLCents / 100).toFixed(2)} virtual.`,
        payload: {
            tradeId,
            grossPnLCents: exit.grossPnLCents,
            netPnLCents: exit.netPnLCents,
            costs: trade.costs,
            exitReason: "manual",
        },
        timestamp: now,
    });

    const state = await getAttemptState(uid, attemptId);
    return state;
}

// ──────────── Cancel ─────────────────────────────────────────────────────────

export async function cancelAttempt(uid: string, attemptId: string, reason: string): Promise<ChallengeAttempt> {
    const now = Date.now();
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt) throw new ArenaError(404, "ATTEMPT_NOT_FOUND", "Challenge attempt not found.");
    if (attempt.status !== "ACTIVE" && attempt.status !== "PAUSED") {
        throw new ArenaError(409, "NOT_CANCELLABLE", `Challenge is ${attempt.status}.`);
    }

    const transition = applyTransition({
        attemptId,
        from: attempt.status,
        to: "CANCELLED",
        timestamp: now,
        reason: reason || "Cancelled by user.",
        eventId: nextEventId("evt"),
        actor: uid,
    });
    if (!transition.changed) throw new InvalidTransitionError(attempt.status, "CANCELLED");

    const cancelled: ChallengeAttempt = {
        ...attempt,
        status: "CANCELLED",
        updatedAt: now,
        settledAt: now,
        cancelReason: reason || "Cancelled by user.",
    };
    await store.saveAttempt(cancelled);
    if (transition.event) await persistEvent(uid, transition.event);
    await store.bumpAnalytics(store.dayKeyNow(now), { cancellations: 1, challengeCompletions: 1 });
    await refreshProfile(uid, now);
    return cancelled;
}

// ──────────── Guardian AI (optional, credit-gated) ───────────────────────────

export async function runGuardianAI(uid: string, attemptId: string): Promise<GuardianAIAnalysis> {
    const now = Date.now();
    const state = await getAttemptState(uid, attemptId);

    let wallet = (await store.getWallet(uid)) ?? emptyWallet(uid, now);
    const debit = consumeAiCredits(wallet, GUARDIAN_AI_COST_CREDITS, now);
    if (!debit.ok) {
        throw new ArenaError(402, "AI_CREDITS_REQUIRED", `Challenge Guardian AI requires ${GUARDIAN_AI_COST_CREDITS} AI credit. Earn or buy AI credits with AV Points.`);
    }

    const symbols = Array.from(new Set(state.recentTrades.map((t) => t.symbol)));
    const { system, user } = buildGuardianPrompt({
        policy: state.attempt.policy,
        metrics: state.metrics,
        insights: state.guardian,
        symbols,
    });

    // Lazy import keeps the AI layer optional (tree-shaken in tests).
    const { defaultRouter } = await import("@/lib/ai/router");
    const response = await defaultRouter.chat({
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        temperature: 0.2,
        maxTokens: 1200,
    });

    if (!response || !response.success || !response.content) {
        // Fail-closed: no charge when AI did not run.
        throw new ArenaError(503, "AI_UNAVAILABLE", "AI provider unavailable — no credits charged.");
    }

    // Charge only after a successful analysis.
    wallet = (await store.getWallet(uid)) ?? emptyWallet(uid, now);
    const charge = consumeAiCredits(wallet, GUARDIAN_AI_COST_CREDITS, now);
    if (charge.ok) await store.saveWallet(charge.wallet);

    const sections = parseGuardianAIResponse(response.content, {
        provider: response.provider,
        model: response.model,
        generatedAt: now,
        creditsCharged: GUARDIAN_AI_COST_CREDITS,
    });

    await persistEvent(uid, {
        eventId: nextEventId("evt"),
        attemptId,
        type: "GUARDIAN_AI",
        severity: "info",
        message: "Challenge Guardian AI analysis generated (informational only — accounting unchanged).",
        payload: { provider: response.provider, model: response.model, creditsCharged: GUARDIAN_AI_COST_CREDITS },
        timestamp: now,
    });
    await store.bumpAnalytics(store.dayKeyNow(now), { aiGuardianRuns: 1 });

    return { ...sections, provider: response.provider, model: response.model, generatedAt: now, creditsCharged: GUARDIAN_AI_COST_CREDITS };
}

// ──────────── Profiles / leaderboard ─────────────────────────────────────────

export async function refreshProfile(uid: string, now = Date.now()): Promise<TraderPerformanceProfile> {
    const attempts = await store.listAttempts(uid, 100);
    const wallet = (await store.getWallet(uid)) ?? emptyWallet(uid, now);
    const existing = await store.getProfile(uid);

    const history: ProfileHistoryItem[] = [];
    for (const attempt of attempts) {
        const result = attempt.result ?? (await store.getResult(uid, attempt.id));
        const trades = await store.listTrades(uid, attempt.id);
        const markets = Array.from(new Set(trades.map((t) => t.market)));
        history.push({ attempt, result, markets });
    }

    const profile = buildTraderProfile({
        userId: uid,
        history,
        avPoints: wallet.avPoints,
        badges: wallet.badges,
        visibility: existing?.visibility ?? "COMMUNITY",
        now,
    });
    await store.saveProfile(profile);
    return profile;
}

async function refreshLeaderboardIndex(attempt: ChallengeAttempt, result: ChallengeResult, now: number): Promise<void> {
    const profile = await store.getProfile(attempt.userId);
    await store.upsertLeaderboardIndex({
        attemptId: attempt.id,
        userId: attempt.userId,
        displayLabel: `Trader ${attempt.userId.slice(-6)}`,
        tier: tierOf(attempt),
        status: attempt.status,
        totalReturnPct: result.totalReturnPct,
        maxDrawdownPct: result.maxDrawdownPct,
        tradingDays: result.tradingDays,
        tradeCount: result.tradeCount,
        consistencyScore: consistencyScoreOf(result),
        profitableDayRatio: 0,
        riskDisciplineScore: 0,
        completionScore: 0,
        score: 0,
        visibility: profile?.visibility ?? "COMMUNITY",
        updatedAt: now,
        maxDrawdownLimitPct: attempt.policy.maxDrawdownPct,
        minTradingDays: attempt.policy.minTradingDays,
        totalTradingDays: result.tradingDays,
        profitableDays: Math.max(0, Math.round((result.winRatePct / 100) * result.tradingDays)),
        breached: result.status === "FAILED",
    });
}

async function maybeRefreshLeaderboardIndex(uid: string, attempt: ChallengeAttempt, metrics: ChallengeMetrics, now: number): Promise<void> {
    const index = await store.listLeaderboardIndex();
    const existing = index.find((e) => e.attemptId === attempt.id);
    if (existing && now - existing.updatedAt < LEADERBOARD_REFRESH_MS) return;

    const trades = await store.listTrades(uid, attempt.id);
    const closed = trades.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => (t.realizedPnLCents ?? 0) > 0).length;
    const profile = await store.getProfile(uid);

    await store.upsertLeaderboardIndex({
        attemptId: attempt.id,
        userId: uid,
        displayLabel: `Trader ${uid.slice(-6)}`,
        tier: tierOf(attempt),
        status: attempt.status,
        totalReturnPct: metrics.totalReturnPct,
        maxDrawdownPct: metrics.currentDrawdownPct,
        tradingDays: metrics.tradingDays,
        tradeCount: closed.length,
        consistencyScore: closed.length > 0 ? Math.round((1 - Math.min(1, metrics.currentDrawdownPct / Math.max(attempt.policy.maxDrawdownPct, 1))) * 100) : 0,
        profitableDayRatio: 0,
        riskDisciplineScore: 0,
        completionScore: 0,
        score: 0,
        visibility: profile?.visibility ?? "COMMUNITY",
        updatedAt: now,
        maxDrawdownLimitPct: attempt.policy.maxDrawdownPct,
        minTradingDays: attempt.policy.minTradingDays,
        totalTradingDays: metrics.tradingDays,
        profitableDays: wins,
        breached: metrics.currentDrawdownPct >= attempt.policy.maxDrawdownPct,
    });
}

function tierOf(attempt: ChallengeAttempt): "starter" | "standard" | "pro" | "elite" | "custom" {
    const dollars = attempt.policy.startingBalanceCents / 100;
    if (dollars <= 10_000) return "starter";
    if (dollars <= 25_000) return "standard";
    if (dollars <= 100_000) return "pro";
    if (dollars <= 200_000) return "elite";
    return "custom";
}

function consistencyScoreOf(result: ChallengeResult): number {
    return result.consistencyPassed ? 100 : 50;
}

export async function getLeaderboard(): Promise<LeaderboardSnapshot | null> {
    const index = await store.listLeaderboardIndex();
    const policy = (await store.getLeaderboardPolicy()) ?? defaultLeaderboardPolicy();
    const now = Date.now();
    const entries = buildLeaderboardEntries(
        index.map((e) => ({
            attemptId: e.attemptId,
            userId: e.userId,
            tier: e.tier,
            status: e.status,
            visibility: e.visibility,
            totalReturnPct: e.totalReturnPct,
            maxDrawdownPct: e.maxDrawdownPct,
            maxDrawdownLimitPct: e.maxDrawdownLimitPct,
            tradingDays: e.tradingDays,
            minTradingDays: e.minTradingDays,
            tradeCount: e.tradeCount,
            consistencyScore: e.consistencyScore,
            profitableDays: e.profitableDays,
            totalTradingDays: e.totalTradingDays,
            breached: e.breached,
        })),
        policy
    );
    const periodKey = `all-${new Date(now).toISOString().slice(0, 7)}`;
    const snapshot = buildLeaderboardSnapshot({ periodKey, visibility: "PUBLIC", entries, policy, now });
    await store.saveLeaderboardSnapshot(snapshot);
    return snapshot;
}

export async function getProfile(uid: string): Promise<TraderPerformanceProfile> {
    return (await refreshProfile(uid)) ?? buildTraderProfile({ userId: uid, history: [], avPoints: 0, badges: [], visibility: "COMMUNITY", now: Date.now() });
}

// ──────────── Performance report ─────────────────────────────────────────────

export async function buildReport(uid: string, attemptId: string): Promise<PerformanceReport | null> {
    const attempt = await store.getAttempt(uid, attemptId);
    if (!attempt || !attempt.result) return null;
    const result = attempt.result;
    const trades = await store.listTrades(uid, attemptId);
    const events = await store.listEvents(uid, attemptId, 500);
    const account = await store.getAccount(uid, attemptId);
    const closed = trades.filter((t) => t.status === "closed");
    const definition = await store.getDefinition(attempt.definitionId);

    const dailyPnl = dailyPnlSeries({ attempt, closedTrades: closed, finalEquityCents: account?.equityCents ?? result.endingEquityCents });
    const symbols = Array.from(new Set(closed.map((t) => t.symbol)));
    const markets = Array.from(new Set(closed.map((t) => t.market)));
    const aiRuns = events.filter((e) => e.type === "GUARDIAN_AI").length;
    const guardianDelivered = events.filter((e) => e.type === "RULE_WARNING" || e.type === "RULE_BREACH").length;

    return {
        ...result,
        definitionKey: attempt.definitionKey,
        definitionName: definition?.name ?? attempt.definitionKey,
        tier: tierOf(attempt),
        startedAt: attempt.startedAt,
        endedAt: attempt.settledAt ?? result.settledAt,
        markets,
        symbolsTraded: symbols,
        strategyCategories: [],
        aiRunsUsed: aiRuns,
        guardianInsightsDelivered: guardianDelivered,
        dailyPnl,
        explanation: settlementExplanation(result, attempt.policy),
        disclaimers: [
            ARENA_DISCLAIMERS.simulated,
            ARENA_DISCLAIMERS.noGuarantees,
            ARENA_DISCLAIMERS.aiInformational,
            ARENA_DISCLAIMERS.challengeScope,
        ],
    };
}
