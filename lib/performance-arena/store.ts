// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — RTDB store (server-side only).
//
// Firebase Realtime Database is the ONLY store (no Firestore, no second DB).
// The namespace is ADDITIVE — it never touches existing user trading accounts,
// marketplace orders, subscriptions or strategy data.
//
//   performanceArena/
//     definitions/{definitionId}          challenge catalog (admin-managed)
//     rewardPolicies/{policyId}           reward configuration
//     attempts/{uid}/{attemptId}          challenge attempts (owner-scoped)
//     accounts/{uid}/{attemptId}          virtual accounts
//     trades/{uid}/{attemptId}/{tradeId}  simulated trades
//     events/{uid}/{attemptId}/{eventId}  immutable challenge events
//     results/{uid}/{attemptId}           settled results
//     equity/{uid}/{attemptId}/{n}        equity curve points (capped)
//     wallets/{uid}                       AV Points / credit balances
//     rewardLedger/{uid}/{rewardId}       immutable reward ledger
//     traderProfiles/{uid}                performance profile
//     leaderboardIndex/{attemptId}        privacy-safe scoring index
//     leaderboardSnapshots/{periodKey}    generated snapshots
//     fraudFlags/{flagId}                 risk flags (separate from perf data)
//     fraudFlagsByUser/{uid}/{flagId}
//     analytics/daily/{dayKey}            aggregate product analytics
//     apiActivity/{uid}/{minuteKey}       rate counters (abuse detection)
//
// ALL writes happen through the Admin SDK on the server. Client security
// rules deny this tree entirely (see database.rules.json) — the browser only
// talks to authenticated API routes, so balances, results, rewards and
// leaderboard data can never be edited client-side.
// ─────────────────────────────────────────────────────────────────────────────

import { adminDatabase } from "@/lib/firebase-admin";
import { defaultChallengeDefinitions, defaultRewardPolicies } from "./policies";
import type {
    ArenaDailyAnalytics,
    ChallengeAttempt,
    ChallengeDefinition,
    ChallengeEvent,
    ChallengeResult,
    ChallengeTrade,
    CreditWallet,
    FraudFlag,
    LeaderboardEntry,
    LeaderboardPolicy,
    LeaderboardSnapshot,
    RewardLedgerEntry,
    RewardPolicy,
    TraderPerformanceProfile,
    VirtualAccount,
} from "./types";
import { emptyWallet } from "./rewards";

export const ARENA_ROOT = "performanceArena";

export function rtdbKey(value: string): string {
    return value.replace(/[.#$[\]/]/g, "_");
}

export function newArenaId(prefix: string): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${ts}_${rand}`;
}

// ──────────── Definitions & policies ─────────────────────────────────────────

export async function listDefinitions(): Promise<ChallengeDefinition[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/definitions`).get();
    const val = snap.val() as Record<string, ChallengeDefinition> | null;
    const now = Date.now();
    if (!val || Object.keys(val).length === 0) {
        // First read seeds the shipped defaults (additive, idempotent).
        const seeded = defaultChallengeDefinitions(now);
        const updates: Record<string, unknown> = {};
        for (const def of seeded) updates[`${ARENA_ROOT}/definitions/${def.id}`] = def;
        await adminDatabase.ref().update(updates);
        return seeded;
    }
    return Object.values(val).sort((a, b) => a.policy.startingBalanceCents - b.policy.startingBalanceCents);
}

export async function getDefinition(definitionId: string): Promise<ChallengeDefinition | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/definitions/${rtdbKey(definitionId)}`).get();
    return (snap.val() as ChallengeDefinition | null) ?? null;
}

export async function saveDefinition(def: ChallengeDefinition): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/definitions/${rtdbKey(def.id)}`).set(def);
}

export async function listRewardPolicies(): Promise<RewardPolicy[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/rewardPolicies`).get();
    const val = snap.val() as Record<string, RewardPolicy> | null;
    const now = Date.now();
    if (!val || Object.keys(val).length === 0) {
        const seeded = defaultRewardPolicies(now);
        const updates: Record<string, unknown> = {};
        for (const p of seeded) updates[`${ARENA_ROOT}/rewardPolicies/${p.id}`] = p;
        await adminDatabase.ref().update(updates);
        return seeded;
    }
    return Object.values(val);
}

export async function getRewardPolicy(policyId: string): Promise<RewardPolicy | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/rewardPolicies/${rtdbKey(policyId)}`).get();
    return (snap.val() as RewardPolicy | null) ?? null;
}

export async function saveRewardPolicy(policy: RewardPolicy): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/rewardPolicies/${rtdbKey(policy.id)}`).set(policy);
}

export async function getLeaderboardPolicy(): Promise<LeaderboardPolicy | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/leaderboardPolicy`).get();
    return (snap.val() as LeaderboardPolicy | null) ?? null;
}

// ──────────── Attempts / accounts / trades / events ──────────────────────────

export async function getAttempt(uid: string, attemptId: string): Promise<ChallengeAttempt | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/attempts/${uid}/${rtdbKey(attemptId)}`).get();
    return (snap.val() as ChallengeAttempt | null) ?? null;
}

export async function listAttempts(uid: string, limit = 50): Promise<ChallengeAttempt[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/attempts/${uid}`).limitToLast(limit).get();
    const val = snap.val() as Record<string, ChallengeAttempt> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => b.startedAt - a.startedAt);
}

export async function listAllAttempts(limit = 500): Promise<ChallengeAttempt[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/attempts`).get();
    const val = snap.val() as Record<string, Record<string, ChallengeAttempt>> | null;
    if (!val) return [];
    const all: ChallengeAttempt[] = [];
    for (const perUser of Object.values(val)) all.push(...Object.values(perUser));
    return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function saveAttempt(attempt: ChallengeAttempt): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/attempts/${attempt.userId}/${rtdbKey(attempt.id)}`).set(attempt);
}

/**
 * Compare-and-swap status transition (idempotent settlement gate).
 * Returns true only for the caller that performed the transition.
 */
export async function casAttemptStatus(
    uid: string,
    attemptId: string,
    expected: string[],
    next: string
): Promise<boolean> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/attempts/${uid}/${rtdbKey(attemptId)}/status`);
    const result = await ref.transaction((current) => {
        if (current === null) return undefined; // abort
        if (!expected.includes(String(current))) return undefined; // abort
        return next;
    });
    return result.committed;
}

export async function getAccount(uid: string, attemptId: string): Promise<VirtualAccount | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/accounts/${uid}/${rtdbKey(attemptId)}`).get();
    return (snap.val() as VirtualAccount | null) ?? null;
}

export async function saveAccount(account: VirtualAccount): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/accounts/${account.userId}/${rtdbKey(account.attemptId)}`).set(account);
}

export async function listTrades(uid: string, attemptId: string): Promise<ChallengeTrade[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/trades/${uid}/${rtdbKey(attemptId)}`).get();
    const val = snap.val() as Record<string, ChallengeTrade> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => a.entryAt - b.entryAt);
}

export async function getTrade(uid: string, attemptId: string, tradeId: string): Promise<ChallengeTrade | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/trades/${uid}/${rtdbKey(attemptId)}/${rtdbKey(tradeId)}`).get();
    return (snap.val() as ChallengeTrade | null) ?? null;
}

export async function saveTrade(trade: ChallengeTrade): Promise<void> {
    await adminDatabase
        .ref(`${ARENA_ROOT}/trades/${trade.userId}/${rtdbKey(trade.attemptId)}/${rtdbKey(trade.tradeId)}`)
        .set(trade);
}

/** Find a trade by its client idempotency key (order retries). */
export async function findTradeByClientRequestId(
    uid: string,
    attemptId: string,
    clientRequestId: string
): Promise<ChallengeTrade | null> {
    const trades = await listTrades(uid, attemptId);
    return trades.find((t) => t.clientRequestId === clientRequestId) ?? null;
}

/** Append an event only if its id does not exist (immutable log, idempotent). */
export async function writeEvent(uid: string, event: ChallengeEvent): Promise<boolean> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/events/${uid}/${rtdbKey(event.attemptId)}/${rtdbKey(event.eventId)}`);
    const result = await ref.transaction((current) => (current === null ? event : undefined));
    return result.committed;
}

export async function listEvents(uid: string, attemptId: string, limit = 100): Promise<ChallengeEvent[]> {
    const snap = await adminDatabase
        .ref(`${ARENA_ROOT}/events/${uid}/${rtdbKey(attemptId)}`)
        .limitToLast(limit)
        .get();
    const val = snap.val() as Record<string, ChallengeEvent> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveResult(uid: string, result: ChallengeResult): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/results/${uid}/${rtdbKey(result.attemptId)}`).set(result);
}

export async function getResult(uid: string, attemptId: string): Promise<ChallengeResult | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/results/${uid}/${rtdbKey(attemptId)}`).get();
    return (snap.val() as ChallengeResult | null) ?? null;
}

// ──────────── Equity curve (capped) ──────────────────────────────────────────

const MAX_EQUITY_POINTS = 500;

export async function appendEquityPoint(uid: string, attemptId: string, point: { t: number; equityCents: number }): Promise<void> {
    const key = String(point.t);
    await adminDatabase.ref(`${ARENA_ROOT}/equity/${uid}/${rtdbKey(attemptId)}/${key}`).set(point);
}

export async function listEquityCurve(uid: string, attemptId: string): Promise<Array<{ t: number; equityCents: number }>> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/equity/${uid}/${rtdbKey(attemptId)}`).get();
    const val = snap.val() as Record<string, { t: number; equityCents: number }> | null;
    if (!val) return [];
    const points = Object.values(val).sort((a, b) => a.t - b.t);
    return points.slice(-MAX_EQUITY_POINTS);
}

// ──────────── Wallets & reward ledger ────────────────────────────────────────

export async function getWallet(uid: string): Promise<CreditWallet> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/wallets/${uid}`).get();
    const val = snap.val() as CreditWallet | null;
    return val ?? emptyWallet(uid, Date.now());
}

export async function saveWallet(wallet: CreditWallet): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/wallets/${wallet.userId}`).set(wallet);
}

/**
 * Idempotent ledger write: creates the entry ONLY when its deterministic id
 * does not exist yet. Returns true when this call created it — replaying the
 * same settlement can never double-grant.
 */
export async function writeLedgerEntry(entry: RewardLedgerEntry): Promise<boolean> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/rewardLedger/${entry.userId}/${rtdbKey(entry.rewardId)}`);
    const result = await ref.transaction((current) => (current === null ? entry : undefined));
    return result.committed;
}

export async function listLedger(uid: string, limit = 200): Promise<RewardLedgerEntry[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/rewardLedger/${uid}`).limitToLast(limit).get();
    const val = snap.val() as Record<string, RewardLedgerEntry> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAllLedger(limit = 500): Promise<RewardLedgerEntry[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/rewardLedger`).get();
    const val = snap.val() as Record<string, Record<string, RewardLedgerEntry>> | null;
    if (!val) return [];
    const all: RewardLedgerEntry[] = [];
    for (const perUser of Object.values(val)) all.push(...Object.values(perUser));
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Revoke a ledger entry (immutable record + status flip). */
export async function revokeLedgerEntry(entry: RewardLedgerEntry, now: number): Promise<boolean> {
    if (entry.status === "REVOKED") return false;
    const ref = adminDatabase.ref(`${ARENA_ROOT}/rewardLedger/${entry.userId}/${rtdbKey(entry.rewardId)}/status`);
    const result = await ref.transaction((current) => (current === "GRANTED" || current === "APPROVED" ? "REVOKED" : undefined));
    if (result.committed) {
        await adminDatabase
            .ref(`${ARENA_ROOT}/rewardLedger/${entry.userId}/${rtdbKey(entry.rewardId)}/revokedAt`)
            .set(now);
    }
    return result.committed;
}

// ──────────── Profiles ───────────────────────────────────────────────────────

export async function getProfile(uid: string): Promise<TraderPerformanceProfile | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/traderProfiles/${uid}`).get();
    return (snap.val() as TraderPerformanceProfile | null) ?? null;
}

export async function saveProfile(profile: TraderPerformanceProfile): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/traderProfiles/${profile.userId}`).set(profile);
}

// ──────────── Leaderboard ────────────────────────────────────────────────────

export interface LeaderboardIndexEntry extends LeaderboardEntry {
    attemptId: string;
    userId: string;
    visibility: "PUBLIC" | "COMMUNITY" | "PRIVATE";
    tier: LeaderboardEntry["tier"];
    updatedAt: number;
    // Raw inputs needed to re-score when weights change:
    maxDrawdownLimitPct: number;
    minTradingDays: number;
    totalTradingDays: number;
    profitableDays: number;
    breached: boolean;
}

export async function upsertLeaderboardIndex(entry: LeaderboardIndexEntry): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/leaderboardIndex/${rtdbKey(entry.attemptId)}`).set(entry);
}

export async function listLeaderboardIndex(): Promise<LeaderboardIndexEntry[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/leaderboardIndex`).get();
    const val = snap.val() as Record<string, LeaderboardIndexEntry> | null;
    if (!val) return [];
    return Object.values(val);
}

export async function saveLeaderboardSnapshot(snapshot: LeaderboardSnapshot): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/leaderboardSnapshots/${rtdbKey(snapshot.periodKey)}`).set(snapshot);
}

export async function getLeaderboardSnapshot(periodKey: string): Promise<LeaderboardSnapshot | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/leaderboardSnapshots/${rtdbKey(periodKey)}`).get();
    return (snap.val() as LeaderboardSnapshot | null) ?? null;
}

// ──────────── Fraud flags ────────────────────────────────────────────────────

export async function writeFraudFlag(flag: FraudFlag): Promise<boolean> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/fraudFlags/${rtdbKey(flag.flagId)}`);
    const result = await ref.transaction((current) => (current === null ? flag : undefined));
    if (result.committed) {
        await adminDatabase.ref(`${ARENA_ROOT}/fraudFlagsByUser/${flag.userId}/${rtdbKey(flag.flagId)}`).set(true);
    }
    return result.committed;
}

export async function listFraudFlags(limit = 200): Promise<FraudFlag[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/fraudFlags`).limitToLast(limit).get();
    const val = snap.val() as Record<string, FraudFlag> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => b.createdAt - a.createdAt);
}

export async function listUserFraudFlags(uid: string, limit = 50): Promise<FraudFlag[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/fraudFlagsByUser/${uid}`).get();
    const keys = snap.val() as Record<string, boolean> | null;
    if (!keys) return [];
    const flags: FraudFlag[] = [];
    for (const key of Object.keys(keys).slice(-limit)) {
        const flagSnap = await adminDatabase.ref(`${ARENA_ROOT}/fraudFlags/${key}`).get();
        const flag = flagSnap.val() as FraudFlag | null;
        if (flag) flags.push(flag);
    }
    return flags.sort((a, b) => b.createdAt - a.createdAt);
}

export async function resolveFraudFlag(flagId: string, status: "REVIEWED" | "DISMISSED", now: number): Promise<void> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/fraudFlags/${rtdbKey(flagId)}`);
    await ref.update({ status, resolvedAt: now });
}

// ──────────── Analytics & rate counters ──────────────────────────────────────

export function dayKeyNow(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

export async function bumpAnalytics(dayKey: string, fields: Partial<ArenaDailyAnalytics>): Promise<void> {
    const ref = adminDatabase.ref(`${ARENA_ROOT}/analytics/daily/${dayKey}`);
    await ref.transaction((current) => {
        const next: ArenaDailyAnalytics = {
            dayKey,
            challengeStarts: 0,
            challengeCompletions: 0,
            passes: 0,
            failures: 0,
            expiries: 0,
            cancellations: 0,
            rewardsGranted: 0,
            pointsIssued: 0,
            aiGuardianRuns: 0,
            paidChallengeStarts: 0,
            proChallengeStarts: 0,
            ...(current ?? {}),
            updatedAt: Date.now(),
        };
        for (const [key, value] of Object.entries(fields)) {
            if (typeof value === "number" && key !== "updatedAt") {
                (next as unknown as Record<string, number>)[key] =
                    ((next as unknown as Record<string, number>)[key] ?? 0) + value;
            }
        }
        return next;
    });
}

export async function listAnalytics(days = 30): Promise<ArenaDailyAnalytics[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/analytics/daily`).get();
    const val = snap.val() as Record<string, ArenaDailyAnalytics> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1)).slice(-days);
}

export async function bumpApiActivity(uid: string, now = Date.now()): Promise<number> {
    const minuteKey = String(Math.floor(now / 60_000));
    const ref = adminDatabase.ref(`${ARENA_ROOT}/apiActivity/${uid}/${minuteKey}`);
    const result = await ref.transaction((current) => (Number(current ?? 0) + 1));
    return Number(result.snapshot.val() ?? 0);
}

// ──────────── Paid Challenge Grants ──────────────────────────────────────────

export interface PaidChallengeGrant {
    uid: string;
    definitionId: string;
    orderId: string;
    amountCents: number;
    grantedAt: number;
    consumed: boolean;
    attemptId?: string;
}

export async function getPaidGrant(uid: string, definitionId: string): Promise<PaidChallengeGrant | null> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/paidGrants/${uid}/${rtdbKey(definitionId)}`).get();
    return (snap.val() as PaidChallengeGrant | null) ?? null;
}

export async function savePaidGrant(grant: PaidChallengeGrant): Promise<void> {
    await adminDatabase.ref(`${ARENA_ROOT}/paidGrants/${grant.uid}/${rtdbKey(grant.definitionId)}`).set(grant);
}

