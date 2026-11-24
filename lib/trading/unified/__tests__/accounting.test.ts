// ─────────────────────────────────────────────────────────────────────────────
// Unified trading — live integration of notional accounting and idempotency.
//
// Uses the in-memory provider + fake store: no RTDB, no broker, no network.
// The notional dependency is a recording fake, so the assertions are about the
// SERVICE's lifecycle (reserve once, release on failure, commit on fill),
// while the ledger algebra itself is covered by lib/risk/tests/notional-accounting.test.ts.
//
// Run: npm run test:trading:accounting
// ─────────────────────────────────────────────────────────────────────────────

import { TradingProviderRegistry } from "../adapter";
import { MockTradingProvider } from "../mock-provider";
import { UnifiedTradingService, type ExecuteInput, type UnifiedTradingDeps } from "../service";
import { hashRequest, type ExecutionRequestRecord } from "../store";
import type { ReserveOutcome } from "@/lib/risk/notional-ledger";
import type { FillObservation } from "@/lib/risk/notional-ledger";
import { createFakeStore } from "./fakes";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) console.log(`  PASS: ${label}`);
    else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function section(name: string): void {
    console.log(`\n${name}`);
}

const NOW = 1_780_000_000_000;
const USER = "user-1";
const ACCOUNT = "mock-account";

interface NotionalSpy {
    reserves: Array<{ reservationId: string; amount: number | undefined; limit: number | undefined }>;
    releases: string[];
    fills: FillObservation[];
    reserveOutcome: ReserveOutcome | "throw" | null;
}

function makeSpy(): NotionalSpy {
    return { reserves: [], releases: [], fills: [], reserveOutcome: null };
}

function build(spy: NotionalSpy, overrides: Partial<UnifiedTradingDeps> = {}) {
    const provider = new MockTradingProvider({ clock: () => NOW, userId: USER, accountId: ACCOUNT, initialBalance: 10_000 });
    const store = createFakeStore();
    const registry = new TradingProviderRegistry([provider]);
    const service = new UnifiedTradingService({
        registry,
        idempotency: store.idempotency,
        persistResult: store.persistResult,
        persistAccount: store.persistAccount,
        audit: store.audit,
        entitlement: async () => true,
        now: () => NOW,
        riskState: async () => ({
            limits: { maxDailyNotional: 1_000_000 },
            state: { balance: 10_000, openPositionsCount: 0 },
        }),
        notional: {
            reserve: async (input) => {
                spy.reserves.push({ reservationId: input.reservationId, amount: input.amount, limit: input.limit });
                if (spy.reserveOutcome === "throw") throw new Error("ledger offline");
                if (spy.reserveOutcome) return spy.reserveOutcome;
                return { ok: true, reserved: true, idempotent: false, used: 0 };
            },
            release: async (input) => {
                spy.releases.push(input.reservationId);
            },
            recordFill: async (input) => {
                spy.fills.push(input.fill);
                return { ok: true };
            },
        },
        ...overrides,
    });
    return { service, provider, store };
}

function entry(clientRequestId: string, extra: Partial<ExecuteInput> = {}): ExecuteInput {
    return {
        userId: USER,
        clientRequestId,
        executionType: "PLACE_ORDER",
        accountId: ACCOUNT,
        symbol: "XAUUSD",
        side: "BUY",
        volume: 0.1,
        kind: "MARKET",
        source: "test",
        ...extra,
    };
}

async function main(): Promise<void> {
    // ── Successful fill: reserve → execute → commit ──────────────────────
    section("successful entry");
    {
        const spy = makeSpy();
        const { service, provider } = build(spy);
        const outcome = await service.execute(entry("acct-req-0001"));
        check(outcome.result.status === "SUCCEEDED", "the mock entry succeeds", outcome.result.status);
        check(spy.reserves.length === 1, "exactly ONE reservation is made", spy.reserves);
        check(spy.reserves[0]?.reservationId === "acct-req-0001", "the reservation is keyed by clientRequestId");
        check((spy.reserves[0]?.limit ?? 0) === 1_000_000, "the configured budget is passed to the ledger");
        check((spy.reserves[0]?.amount ?? 0) > 0, "the reservation carries a computed notional", spy.reserves[0]?.amount);
        check(spy.fills.length === 1, "the provider fill is committed once", spy.fills);
        check(spy.releases.length === 0, "a successful fill is not released");
        check(provider.executeCount === 1, "the provider executed exactly once");
        const fill = spy.fills[0];
        check(fill.orderId === "acct-req-0001", "the fill is scoped to its order");
        check(fill.fillId.startsWith("acct-req-0001:"), "the fill identity is order + provider reference", fill.fillId);
        check(fill.volume > 0 && fill.price > 0, "the committed fill carries real volume and price");
    }

    // ── Provider rejection: reservation released, nothing committed ──────
    section("provider rejection");
    {
        const spy = makeSpy();
        const { service } = build(spy);
        const outcome = await service.execute(entry("acct-req-0002", { symbol: "NOPE" }));
        check(outcome.result.status === "REJECTED", "an invalid symbol is rejected", outcome.result.status);
        check(spy.reserves.length === 1, "the reservation was made before submission");
        check(spy.releases.length === 1, "a rejection releases the reservation");
        check(spy.fills.length === 0, "a rejection commits no fill");
    }

    // ── Budget rejection: provider never called ──────────────────────────
    section("budget rejection");
    {
        const spy = makeSpy();
        spy.reserveOutcome = { ok: false, code: "BUDGET_EXCEEDED", reason: "Daily notional budget reached." };
        const { service, provider } = build(spy);
        const outcome = await service.execute(entry("acct-req-0003"));
        check(
            outcome.result.status === "REJECTED" && outcome.result.error?.code === "RISK_REJECTED",
            "the ledger rejection blocks the entry",
            outcome.result.error,
        );
        check(provider.executeCount === 0, "the provider is never called after a budget rejection");
        check(spy.fills.length === 0, "no fill is committed");
    }

    // ── Ledger unavailable: fail closed ──────────────────────────────────
    section("ledger unavailable");
    {
        const spy = makeSpy();
        spy.reserveOutcome = "throw";
        const { service, provider } = build(spy);
        const outcome = await service.execute(entry("acct-req-0004"));
        check(
            outcome.result.status === "REJECTED" && /fail closed/i.test(outcome.result.error?.message ?? ""),
            "an unavailable ledger blocks execution (fail closed)",
            outcome.result.error,
        );
        check(provider.executeCount === 0, "no submission happens without accounting");
    }

    // ── No configured budget: no reservation ─────────────────────────────
    section("no budget configured");
    {
        const spy = makeSpy();
        const { service } = build(spy, {
            riskState: async () => ({ limits: {}, state: { balance: 10_000 } }),
        });
        const outcome = await service.execute(entry("acct-req-0005"));
        check(outcome.result.status === "SUCCEEDED", "the entry still executes");
        check(spy.reserves.length === 0, "no ledger write when no budget is configured");
        check(spy.fills.length === 0, "no fill commit without a reservation");
    }

    // ── Stale in-flight claim: reconcile, never resubmit ─────────────────
    section("stale in-flight claim");
    {
        const spy = makeSpy();
        const staleRecord: ExecutionRequestRecord = {
            clientRequestId: "acct-req-0006",
            correlationId: "corr",
            userId: USER,
            accountId: ACCOUNT,
            provider: "MT5",
            environment: "DEMO",
            status: "ACCEPTED",
            createdAt: NOW - 10 * 60_000,
            completedAt: null,
            requestHash: "hash",
        };
        const { service, provider } = build(spy, {
            idempotency: async () => ({ kind: "REPLAY", record: staleRecord, result: null }),
        });
        const outcome = await service.execute(entry("acct-req-0006"));
        check(
            outcome.result.status === "REJECTED" && outcome.result.error?.code === "EXECUTION_TIMEOUT",
            "an abandoned in-flight request is reported as a timeout, not a duplicate",
            outcome.result.error,
        );
        check(provider.executeCount === 0, "an abandoned claim is NEVER resubmitted automatically");
        check(spy.reserves.length === 0, "no new reservation is made for a replay");
    }

    // ── A stored result is replayed, not re-executed ─────────────────────
    section("completed replay");
    {
        const spy = makeSpy();
        const { service, provider, store } = build(spy);
        const first = await service.execute(entry("acct-req-0007"));
        const replay = await service.execute(entry("acct-req-0007"));
        check(first.result.status === "SUCCEEDED", "first execution succeeds");
        check(replay.result.duplicate === true, "the retry is marked duplicate");
        check(replay.result.status === first.result.status, "the retry replays the settled status");
        check(provider.executeCount === 1, "the provider executed once across both calls");
        check(store.resultLog().length === 1, "only one result was persisted");
        check(spy.reserves.length === 1, "the retry does not reserve again");
        check(spy.fills.length === 1, "the retry does not commit a second fill");
    }

    // ── Same key, different protective levels → conflict ─────────────────
    section("payload conflict");
    {
        const spy = makeSpy();
        const { service, provider } = build(spy);
        await service.execute(entry("acct-req-0008", { stopLoss: 3900, takeProfit: 4100 }));
        const executedBefore = provider.executeCount;
        const conflict = await service.execute(entry("acct-req-0008", { stopLoss: 3800, takeProfit: 4100 }));
        check(
            conflict.result.status === "REJECTED" && conflict.result.error?.code === "DUPLICATE_REQUEST",
            "a reused key with different SL is a conflict, not a replay",
            conflict.result.error,
        );
        check(provider.executeCount === executedBefore, "the conflicting request never reaches the provider");
    }

    // ── Request hash covers every economically meaningful field ─────────
    section("request hash");
    const baseHash = {
        userId: USER,
        accountId: ACCOUNT,
        provider: "MT5" as const,
        environment: "DEMO" as const,
        executionType: "PLACE_ORDER",
        symbol: "XAUUSD",
        side: "BUY",
        kind: "MARKET",
        price: null,
        stopLoss: 3900,
        takeProfit: 4100,
        volume: 0.1,
    };
    check(hashRequest(baseHash) === hashRequest({ ...baseHash }), "identical payloads hash identically");
    check(hashRequest(baseHash) !== hashRequest({ ...baseHash, stopLoss: 3899 }), "a different SL changes the hash");
    check(hashRequest(baseHash) !== hashRequest({ ...baseHash, takeProfit: 4200 }), "a different TP changes the hash");
    check(hashRequest(baseHash) !== hashRequest({ ...baseHash, kind: "LIMIT" }), "a different order kind changes the hash");
    check(hashRequest(baseHash) !== hashRequest({ ...baseHash, volume: 0.11 }), "a different volume changes the hash");
    check(hashRequest(baseHash) !== hashRequest({ ...baseHash, accountId: "other-account" }), "another account changes the hash");

    console.log(`\n${failures === 0 ? "🎉 ALL TRADING-ACCOUNTING TESTS PASSED" : `❌ ${failures} TEST(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
