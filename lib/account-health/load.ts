// Reads the raw account facts that `buildAccountHealthReport` turns into a
// verdict. Shared by `/api/account-health` (self-service) and
// `/api/admin/account-health` (operator view) so the two can never disagree
// about what an account's health is.
//
// ── Server-only ───────────────────────────────────────────────────────────────
// Imports `lib/firebase-admin`, which reads service-account credentials from the
// environment at import time. Never import this from a client component.
//
// ── The paths here are the real ones ──────────────────────────────────────────
// Verified against live RTDB, not assumed. The three that matter:
//
//   trading_accounts/{uid}/{accountId}      balance, equity, freeMargin,
//                                           margin, marginLevel, currency
//   trading_positions/{uid}/{accountId}/{id}  the open book
//   live_accounts/{accountId}               peakEquity, drawdown
//
// There is no `users/{uid}/balance` and no `trading_accounts/{uid}/default`.
// Earlier revisions read those; they resolved to nothing, which is why a real
// $66.06 account reported a $0 balance and a margin call that never happened.
// Do not reintroduce a path here without checking it against the database.

import { adminDatabase } from "@/lib/firebase-admin";
import type {
    AccountHealthAccount,
    AccountHealthFacts,
    AccountHealthPosition,
    AccountHealthSignal,
} from "./types";

/** Signal outcomes older than this are ignored by the quality metric. */
const SIGNAL_WINDOW_DAYS = 30;
/** Upper bound on signals folded into the report. */
const SIGNAL_LIMIT = 200;

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Recent signal outcomes from the shared `aiSignals` library.
 *
 * Deliberately best-effort: the signal library is the largest collection in the
 * database, and a read failure there must not take the whole risk report down
 * with it. Returning an empty list degrades the score by at most the 15 signal
 * points, which is reported explicitly as `signalQuality: 0` rather than
 * silently replaced with a flattering default.
 */
export async function readRecentSignals(now: number = Date.now()): Promise<AccountHealthSignal[]> {
    let snap: { exists: () => boolean; val: () => unknown; forEach: (cb: (c: { val: () => unknown }) => void) => void };
    try {
        snap = await adminDatabase.ref("aiSignals").get();
    } catch {
        return [];
    }
    if (!snap?.exists?.()) return [];

    const cutoff = now - SIGNAL_WINDOW_DAYS * 86_400_000;
    const out: AccountHealthSignal[] = [];
    snap.forEach((child) => {
        const s = child?.val?.();
        if (!s || typeof s !== "object") return;
        const record = s as AccountHealthSignal & { id?: unknown };
        if (!record.id) return;
        if (num(record.createdAt) <= cutoff) return;
        out.push(record);
    });
    return out.slice(0, SIGNAL_LIMIT);
}

/**
 * Turn `trading_accounts/{uid}` into a flat list of broker accounts.
 *
 * The node is keyed by `accountId` (`gateway_5054775401`), and each child is one
 * MT5 account — not a wrapper with a nested balance.
 */
function collectAccounts(node: unknown): AccountHealthAccount[] {
    return Object.entries(asObject(node)).map(([accountId, raw]) => {
        const record = asObject(raw);
        // The key is authoritative for the id; the field is a convenience copy.
        return { ...record, accountId: typeof record.accountId === "string" ? record.accountId : accountId };
    });
}

/**
 * Turn `trading_positions/{uid}` into a flat list of positions.
 *
 * Two levels of nesting: accountId, then position id. Reading the node one level
 * shallower yields "number of broker accounts" where the UI promises "number of
 * open positions".
 */
function collectPositions(node: unknown): AccountHealthPosition[] {
    const out: AccountHealthPosition[] = [];
    for (const [accountId, byId] of Object.entries(asObject(node))) {
        for (const raw of Object.values(asObject(byId))) {
            const record = asObject(raw);
            out.push({ ...record, accountId });
        }
    }
    return out;
}

/**
 * Peak equity and worst drawdown from the live-account tracker.
 *
 * `live_accounts/{accountId}` is written by the performance heartbeat and is the
 * only place the platform records a historical peak. Without it a drawdown
 * report can only ever describe the present moment.
 *
 * Best-effort per account: a missing tracker record contributes nothing rather
 * than contributing a fake 0, and one bad child must not fail the report.
 */
async function readPeakDrawdown(accountIds: string[]): Promise<{ maxDrawdown: number; peakEquity: number }> {
    if (accountIds.length === 0) return { maxDrawdown: 0, peakEquity: 0 };

    const snapshots = await Promise.all(accountIds.map(async (id) => {
        try {
            const snap = await adminDatabase.ref(`live_accounts/${id}`).get();
            return snap.exists() ? asObject(snap.val()) : null;
        } catch {
            return null;
        }
    }));

    let maxDrawdown = 0;
    let peakEquity = 0;
    for (const record of snapshots) {
        if (!record) continue;
        maxDrawdown = Math.max(maxDrawdown, num(record.drawdown));
        peakEquity = Math.max(peakEquity, num(record.peakEquity));
    }
    return { maxDrawdown, peakEquity };
}

/** Collect every fact the scorer needs for one user. */
export async function loadAccountHealthFacts(uid: string): Promise<AccountHealthFacts> {
    const [accountsSnap, positionsSnap, signals] = await Promise.all([
        adminDatabase.ref(`trading_accounts/${uid}`).get(),
        adminDatabase.ref(`trading_positions/${uid}`).get(),
        readRecentSignals(),
    ]);

    const accounts = accountsSnap.exists() ? collectAccounts(accountsSnap.val()) : [];
    const { maxDrawdown, peakEquity } = await readPeakDrawdown(
        accounts.map((a) => String(a.accountId ?? "")).filter(Boolean),
    );

    return {
        accounts,
        positions: positionsSnap.exists() ? collectPositions(positionsSnap.val()) : [],
        maxDrawdown,
        peakEquity,
        signals,
    };
}

/**
 * Best-effort identity for an operator-facing report.
 *
 * Kept separate from the health facts on purpose: a missing or malformed
 * profile must degrade the header to a bare uid, never fail the risk report.
 */
export async function readAccountIdentity(
    uid: string,
): Promise<{ email: string | null; displayName: string | null }> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}`).get();
        if (!snap.exists()) return { email: null, displayName: null };
        const u = asObject(snap.val());
        return {
            email: typeof u.email === "string" ? u.email : null,
            displayName: typeof u.displayName === "string" ? u.displayName : null,
        };
    } catch {
        return { email: null, displayName: null };
    }
}

/**
 * Health facts for every user on the platform, in a fixed number of reads.
 *
 * The single-account path costs several reads per user plus one per broker
 * account, so scoring a directory that way is O(n) round trips and gets slow
 * fast. This reads the collection nodes once and folds them in memory.
 *
 * `live_accounts` is keyed by accountId rather than uid, so the peak-drawdown
 * lookup cannot be folded here without a second pass. It is a single node read
 * and a local join — still one round trip, not one per user.
 */
export async function loadAccountHealthDirectory(): Promise<Array<{
    uid: string;
    email: string | null;
    displayName: string | null;
    facts: AccountHealthFacts;
}>> {
    const [usersSnap, accountsSnap, positionsSnap, liveSnap, signals] = await Promise.all([
        adminDatabase.ref("users").get(),
        adminDatabase.ref("trading_accounts").get(),
        adminDatabase.ref("trading_positions").get(),
        adminDatabase.ref("live_accounts").get().catch(() => null),
        readRecentSignals(),
    ]);

    const users = asObject(usersSnap.val());
    const allAccounts = asObject(accountsSnap.val());
    const allPositions = asObject(positionsSnap.val());
    const live = liveSnap?.exists?.() ? asObject(liveSnap.val()) : {};

    // `live_accounts` is keyed by accountId, so index it for a local join.
    const liveByAccountId = new Map<string, Record<string, unknown>>();
    for (const [accountId, raw] of Object.entries(live)) {
        liveByAccountId.set(accountId, asObject(raw));
    }

    const out: Array<{
        uid: string;
        email: string | null;
        displayName: string | null;
        facts: AccountHealthFacts;
    }> = [];

    // `users` is the spine: it is the one node every account must have. A uid
    // that exists only under trading_accounts is still listed, keyed by itself,
    // so an account is never invisible just because its profile is missing.
    const uids = new Set([...Object.keys(users), ...Object.keys(allAccounts), ...Object.keys(allPositions)]);

    for (const uid of uids) {
        if (!uid) continue;
        const profile = asObject(users[uid]);
        const accounts = allAccounts[uid] ? collectAccounts(allAccounts[uid]) : [];

        let maxDrawdown = 0;
        let peakEquity = 0;
        for (const account of accounts) {
            const record = liveByAccountId.get(String(account.accountId ?? ""));
            if (!record) continue;
            maxDrawdown = Math.max(maxDrawdown, num(record.drawdown));
            peakEquity = Math.max(peakEquity, num(record.peakEquity));
        }

        out.push({
            uid,
            email: typeof profile.email === "string" ? profile.email : null,
            displayName: typeof profile.displayName === "string" ? profile.displayName : null,
            facts: {
                accounts,
                positions: allPositions[uid] ? collectPositions(allPositions[uid]) : [],
                maxDrawdown,
                peakEquity,
                // The signal library is platform-wide, so every account shares it.
                // The scorer keeps it out of `hasData` and out of the win rate
                // when nothing has resolved, so this cannot manufacture a verdict.
                signals,
            },
        });
    }

    return out;
}
