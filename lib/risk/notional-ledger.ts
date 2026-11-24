/**
 * AlgoVault — Daily notional accounting.
 *
 * The Risk Engine enforces `maxDailyNotional` from `dailyNotionalUsed`, but
 * nothing in the platform ever *produced* that number. This module is the
 * accounting layer that closes the gap, and it is deliberately split in two:
 *
 *   • PURE ledger algebra (exported, no I/O) — day rollover, reservation,
 *     fill application, duplicate detection. Fully unit-testable.
 *   • Thin RTDB wrappers that run the algebra inside a `transaction()` on
 *     `trading_controls/{userId}/{accountKey}/notionalLedger`, so two
 *     concurrent submissions can never both slip under the same budget.
 *
 * Accounting rules (each one is a requirement, not a preference):
 *
 *   1. A submitted order is NOT a fill. Submission only *reserves* notional;
 *      the reservation is converted to usage by the broker's fill report.
 *   2. A fill is counted once. The ledger key is the fill identity
 *      (`clientOrderId:mt5Ticket`), and a repeated report with the same or a
 *      smaller volume adds nothing.
 *   3. Partial fills accumulate. A second report with a larger cumulative
 *      volume adds only the difference.
 *   4. Rejected / failed / cancelled orders only release their reservation —
 *      they never consume notional.
 *   5. A fill whose symbol has no resolved contract size is recorded as
 *      UNACCOUNTED: the usage total is left alone and the account is marked
 *      incomplete so the risk engine can fail closed instead of enforcing a
 *      budget against a guessed number.
 *   6. The day boundary is 00:00 in `NOTIONAL_DAY_TIMEZONE` (default UTC) and
 *      the ledger resets on the first observation of a new day.
 *
 * `dailyNotionalUsed` is `used + reserved`: committed fills plus in-flight
 * reservations. That is what makes concurrent submissions unable to exceed
 * the configured budget.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { contractSizeFor } from "./risk-engine";

/** Default daily reset boundary timezone. Overridable per deployment. */
export const NOTIONAL_DAY_TIMEZONE = process.env.NOTIONAL_DAY_TIMEZONE?.trim() || "UTC";

/** Ledger records kept per account per day (oldest pruned first). */
const MAX_FILL_RECORDS = 500;
const EPSILON = 1e-9;

export interface NotionalReservation {
    amount: number;
    at: number;
}

export interface NotionalFillRecord {
    volume: number;
    /** null when the symbol has no resolved contract size (unaccounted). */
    notional: number | null;
    symbol: string;
    price: number;
    at: number;
}

export interface NotionalUnaccountedFill {
    symbol: string;
    volume: number;
    price: number;
    at: number;
    reason: string;
}

export interface NotionalLedger {
    version: 1;
    /** YYYY-MM-DD in `timezone`. */
    day: string;
    timezone: string;
    /** Committed notional from confirmed fills. */
    used: number;
    /** Reserved notional for submitted orders not yet reported. */
    reserved: number;
    reservations: Record<string, NotionalReservation>;
    fills: Record<string, NotionalFillRecord>;
    unaccounted: Record<string, NotionalUnaccountedFill>;
    updatedAt: number;
}

export interface FillObservation {
    /** Stable broker fill identity; re-reports of the same fill reuse it. */
    fillId: string;
    /** Order identity used to release the submission reservation. */
    orderId: string;
    symbol: string;
    volume: number;
    price: number;
    at: number;
}

// ─── Pure algebra ────────────────────────────────────────────────────────────

/**
 * The ledger's day key. `en-CA` yields ISO `YYYY-MM-DD`, so the key sorts and
 * compares lexicographically. An invalid timezone throws in `Intl`; callers
 * get UTC rather than a crash loop in the trading path.
 */
export function notionalDayKey(now: number, timeZone: string = NOTIONAL_DAY_TIMEZONE): string {
    const date = new Date(Number.isFinite(now) ? now : Date.now());
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

export function emptyNotionalLedger(day: string, timeZone: string = NOTIONAL_DAY_TIMEZONE): NotionalLedger {
    return {
        version: 1,
        day,
        timezone: timeZone,
        used: 0,
        reserved: 0,
        reservations: {},
        fills: {},
        unaccounted: {},
        updatedAt: 0,
    };
}

function finiteNonNegative(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Normalize whatever RTDB returned into a ledger for `today`. A record from a
 * previous day resets to zero — that is the daily boundary. Garbage in any
 * field is dropped, never coerced into a plausible-looking number.
 */
export function normalizeNotionalLedger(
    raw: unknown,
    day: string,
    timeZone: string = NOTIONAL_DAY_TIMEZONE,
): NotionalLedger {
    if (!raw || typeof raw !== "object") return emptyNotionalLedger(day, timeZone);
    const value = raw as Record<string, unknown>;
    if (String(value.day ?? "") !== day) return emptyNotionalLedger(day, timeZone);

    const ledger = emptyNotionalLedger(day, timeZone);
    ledger.used = finiteNonNegative(value.used) ?? 0;
    ledger.reserved = finiteNonNegative(value.reserved) ?? 0;
    ledger.updatedAt = finiteNonNegative(value.updatedAt) ?? 0;

    if (value.reservations && typeof value.reservations === "object") {
        for (const [id, rawEntry] of Object.entries(value.reservations as Record<string, unknown>)) {
            if (!rawEntry || typeof rawEntry !== "object") continue;
            const entry = rawEntry as Record<string, unknown>;
            const amount = finiteNonNegative(entry.amount);
            const at = finiteNonNegative(entry.at) ?? 0;
            if (amount !== undefined && amount > 0) ledger.reservations[id] = { amount, at };
        }
    }

    if (value.fills && typeof value.fills === "object") {
        for (const [id, rawEntry] of Object.entries(value.fills as Record<string, unknown>)) {
            if (!rawEntry || typeof rawEntry !== "object") continue;
            const entry = rawEntry as Record<string, unknown>;
            const volume = finiteNonNegative(entry.volume);
            const price = finiteNonNegative(entry.price);
            if (volume === undefined || price === undefined) continue;
            const notional = entry.notional === null ? null : finiteNonNegative(entry.notional);
            ledger.fills[id] = {
                volume,
                notional: notional === undefined ? null : notional,
                symbol: String(entry.symbol ?? ""),
                price,
                at: finiteNonNegative(entry.at) ?? 0,
            };
        }
    }

    if (value.unaccounted && typeof value.unaccounted === "object") {
        for (const [id, rawEntry] of Object.entries(value.unaccounted as Record<string, unknown>)) {
            if (!rawEntry || typeof rawEntry !== "object") continue;
            const entry = rawEntry as Record<string, unknown>;
            ledger.unaccounted[id] = {
                symbol: String(entry.symbol ?? ""),
                volume: finiteNonNegative(entry.volume) ?? 0,
                price: finiteNonNegative(entry.price) ?? 0,
                at: finiteNonNegative(entry.at) ?? 0,
                reason: String(entry.reason ?? "unaccounted"),
            };
        }
    }

    return ledger;
}

/** Usage the risk engine sees: committed fills + in-flight reservations. */
export function effectiveDailyNotional(ledger: NotionalLedger): number {
    return Math.round((ledger.used + ledger.reserved) * 1e6) / 1e6;
}

/** True when at least one confirmed fill could not be priced honestly. */
export function notionalAccountingIncomplete(ledger: NotionalLedger): boolean {
    return Object.keys(ledger.unaccounted).length > 0;
}

export type ReservePlan =
    | { ok: true; ledger: NotionalLedger; reserved: boolean; idempotent: boolean }
    | { ok: false; code: "BUDGET_EXCEEDED"; reason: string };

/**
 * Reserve `amount` for a submission.
 *
 * The SAME reservation id (the clientRequestId) is idempotent: a retried
 * submission does not reserve twice, so a timeout + retry cannot exhaust a
 * budget on its own. A limit ≤ 0 means "no budget configured" and reserves
 * nothing.
 */
export function reserveInNotionalLedger(
    ledger: NotionalLedger,
    id: string,
    amount: number | undefined,
    limit: number | undefined,
    now: number,
): ReservePlan {
    const budget = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : undefined;
    if (budget === undefined) return { ok: true, ledger, reserved: false, idempotent: false };

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        // With a budget configured, an order whose notional cannot be computed
        // is unknown exposure. Fail closed rather than let it through.
        return {
            ok: false,
            code: "BUDGET_EXCEEDED",
            reason: "Order notional could not be computed while a daily notional budget is configured.",
        };
    }

    const existing = ledger.reservations[id];
    if (existing) {
        return { ok: true, ledger, reserved: true, idempotent: true };
    }

    const projected = ledger.used + ledger.reserved + amount;
    if (projected > budget + EPSILON) {
        return {
            ok: false,
            code: "BUDGET_EXCEEDED",
            reason: `Daily notional budget reached (${Math.round(ledger.used)} used + ${Math.round(
                ledger.reserved,
            )} reserved + ${Math.round(amount)} > ${Math.round(budget)}).`,
        };
    }

    return {
        ok: true,
        reserved: true,
        idempotent: false,
        ledger: {
            ...ledger,
            reserved: round6(ledger.reserved + amount),
            reservations: { ...ledger.reservations, [id]: { amount: round6(amount), at: now } },
            updatedAt: now,
        },
    };
}

export type ReleasePlan = { ledger: NotionalLedger; released: boolean };

/** Release a reservation (rejected / failed / cancelled order). Idempotent. */
export function releaseInNotionalLedger(ledger: NotionalLedger, id: string, now: number): ReleasePlan {
    const existing = ledger.reservations[id];
    if (!existing) return { ledger, released: false };
    const reservations = { ...ledger.reservations };
    delete reservations[id];
    return {
        released: true,
        ledger: {
            ...ledger,
            reserved: round6(Math.max(0, ledger.reserved - existing.amount)),
            reservations,
            updatedAt: now,
        },
    };
}

export type FillPlan = {
    ledger: NotionalLedger;
    /** Notional added by this report (0 for a duplicate or unaccounted fill). */
    added: number;
    duplicate: boolean;
    unaccounted: boolean;
    /** False when the observation itself is unusable (never counted). */
    valid: boolean;
    reason?: string;
};

/**
 * Apply one broker fill report.
 *
 * `volume` is treated as cumulative for the fill identity: re-reports with the
 * same volume are duplicates, a larger volume adds only the delta, and a
 * smaller volume is ignored (usage never decreases intraday — the conservative
 * direction for a budget).
 */
export function applyFillToNotionalLedger(
    ledger: NotionalLedger,
    fill: FillObservation,
    now: number,
): FillPlan {
    const volume = Number(fill.volume);
    const price = Number(fill.price);
    if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(price) || price <= 0) {
        // A confirmed fill we cannot price is UNACCOUNTED, not zero. Recording
        // it makes the day incomplete so the budget check fails closed.
        return {
            ledger: {
                ...ledger,
                unaccounted: {
                    ...ledger.unaccounted,
                    [fill.fillId]: {
                        symbol: fill.symbol,
                        volume: Number.isFinite(volume) ? volume : 0,
                        price: Number.isFinite(price) ? price : 0,
                        at: fill.at,
                        reason: "Fill report carried no usable volume/price.",
                    },
                },
                updatedAt: now,
            },
            added: 0,
            duplicate: false,
            unaccounted: true,
            valid: false,
            reason: "Fill report has no usable volume/price; it cannot be counted.",
        };
    }

    const previous = ledger.fills[fill.fillId];
    const delta = round6(volume - (previous?.volume ?? 0));
    const next: NotionalLedger = {
        ...ledger,
        fills: {
            ...ledger.fills,
            [fill.fillId]: { volume: round6(volume), notional: null, symbol: fill.symbol, price, at: fill.at },
        },
        updatedAt: now,
    };

    // Release the submission reservation regardless of whether the fill adds
    // anything new: a fill report settles the in-flight order.
    const released = releaseInNotionalLedger(next, fill.orderId, now);
    next.reserved = released.ledger.reserved;
    next.reservations = released.ledger.reservations;

    if (delta <= EPSILON) {
        const priorNotional = previous?.notional ?? null;
        next.fills[fill.fillId].notional = priorNotional;
        return { ledger: next, added: 0, duplicate: true, unaccounted: false, valid: true };
    }

    const contractSize = contractSizeFor(fill.symbol);
    if (!(typeof contractSize === "number" && contractSize > 0)) {
        next.unaccounted = {
            ...next.unaccounted,
            [fill.fillId]: {
                symbol: fill.symbol,
                volume: round6(volume),
                price,
                at: fill.at,
                reason: "No resolved contract size for this symbol; notional not counted.",
            },
        };
        return {
            ledger: next,
            added: 0,
            duplicate: false,
            unaccounted: true,
            valid: true,
            reason: "No resolved contract size for this symbol; the fill is recorded as unaccounted.",
        };
    }

    const added = round6(delta * contractSize * price);
    next.fills[fill.fillId].notional = previous ? round6((previous.notional ?? 0) + added) : added;
    next.used = round6(ledger.used + added);
    return { ledger: pruneFills(next), added, duplicate: false, unaccounted: false, valid: true };
}

function pruneFills(ledger: NotionalLedger): NotionalLedger {
    const ids = Object.keys(ledger.fills);
    if (ids.length <= MAX_FILL_RECORDS) return ledger;
    ids.sort((a, b) => (ledger.fills[a]?.at ?? 0) - (ledger.fills[b]?.at ?? 0));
    const drop = new Set(ids.slice(0, ids.length - MAX_FILL_RECORDS));
    const fills: Record<string, NotionalFillRecord> = {};
    for (const id of ids) if (!drop.has(id)) fills[id] = ledger.fills[id];
    return { ...ledger, fills };
}

function round6(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1e6) / 1e6;
}

// ─── RTDB wrappers ───────────────────────────────────────────────────────────

export function notionalLedgerPath(userId: string, accountKey: string): string {
    return `trading_controls/${userId}/${accountKey}/notionalLedger`;
}

export async function readNotionalLedger(
    userId: string,
    accountKey: string,
    now: number = Date.now(),
): Promise<NotionalLedger> {
    const snap = await adminDatabase.ref(notionalLedgerPath(userId, accountKey)).get();
    return normalizeNotionalLedger(snap.val(), notionalDayKey(now));
}

export type ReserveOutcome =
    | { ok: true; reserved: boolean; idempotent: boolean; used: number }
    | { ok: false; code: "BUDGET_EXCEEDED" | "STATE_UNAVAILABLE"; reason: string };

/**
 * Atomically reserve notional for a submission.
 *
 * The transaction is what makes concurrent submissions safe: each one reads
 * the same committed ledger, the first commits a reservation and the second
 * sees it. Any read/write failure is STATE_UNAVAILABLE — fail closed.
 */
export async function reserveNotional(input: {
    userId: string;
    accountKey: string;
    reservationId: string;
    amount: number | undefined;
    limit: number | undefined;
    now?: number;
}): Promise<ReserveOutcome> {
    const now = input.now ?? Date.now();
    const ref = adminDatabase.ref(notionalLedgerPath(input.userId, input.accountKey));
    let outcome: ReserveOutcome | null = null;

    try {
        await ref.transaction((current) => {
            const ledger = normalizeNotionalLedger(current, notionalDayKey(now));
            const plan = reserveInNotionalLedger(
                ledger,
                input.reservationId,
                input.amount,
                input.limit,
                now,
            );
            if (!plan.ok) {
                outcome = { ok: false, code: plan.code, reason: plan.reason };
                return undefined;
            }
            outcome = {
                ok: true,
                reserved: plan.reserved,
                idempotent: plan.idempotent,
                used: effectiveDailyNotional(plan.ledger),
            };
            return plan.ledger;
        });
    } catch (error) {
        return {
            ok: false,
            code: "STATE_UNAVAILABLE",
            reason: `Daily notional ledger is unavailable (${
                error instanceof Error ? error.message : "unknown error"
            }) — failing closed.`,
        };
    }

    if (!outcome) {
        return {
            ok: false,
            code: "STATE_UNAVAILABLE",
            reason: "Daily notional ledger transaction did not commit — failing closed.",
        };
    }
    return outcome;
}

export async function releaseNotional(input: {
    userId: string;
    accountKey: string;
    reservationId: string;
    now?: number;
}): Promise<void> {
    const now = input.now ?? Date.now();
    const ref = adminDatabase.ref(notionalLedgerPath(input.userId, input.accountKey));
    await ref.transaction((current) => {
        const ledger = normalizeNotionalLedger(current, notionalDayKey(now));
        if (!ledger.reservations[input.reservationId]) return undefined;
        return releaseInNotionalLedger(ledger, input.reservationId, now).ledger;
    });
}

export type RecordFillOutcome = {
    ok: true;
    added: number;
    duplicate: boolean;
    unaccounted: boolean;
    used: number;
    day: string;
} | {
    ok: false;
    reason: string;
};

/**
 * Account one confirmed broker fill. Called from the authenticated gateway
 * execution report — the only authoritative fill event in the platform.
 *
 * Throws only when RTDB itself fails, so the gateway route can return a
 * non-2xx and the EA retries the report. Retries are safe: the fill identity
 * makes the second application a duplicate.
 */
export async function recordFillNotional(input: {
    userId: string;
    accountKey: string;
    fill: FillObservation;
    now?: number;
}): Promise<RecordFillOutcome> {
    const now = input.now ?? Date.now();
    const day = notionalDayKey(now);
    const ref = adminDatabase.ref(notionalLedgerPath(input.userId, input.accountKey));
    let result: RecordFillOutcome | null = null;

    await ref.transaction((current) => {
        const ledger = normalizeNotionalLedger(current, day);
        const plan = applyFillToNotionalLedger(ledger, input.fill, now);
        result = {
            ok: true,
            added: plan.added,
            duplicate: plan.duplicate,
            unaccounted: plan.unaccounted,
            used: effectiveDailyNotional(plan.ledger),
            day,
        };
        return plan.ledger;
    });

    return (
        result ?? {
            ok: false,
            reason: "Fill was not recorded: the ledger transaction did not commit.",
        }
    );
}
