/**
 * SECURITY NEGATIVE TEST — scalping bot API authorization & demo-only rule.
 *
 * Drives the real route handlers against the in-memory firebase-admin stub.
 * Asserts:
 *   1. Non-Pro and anonymous callers are rejected (401) — entitlement is
 *      re-derived server-side, not trusted from the client.
 *   2. `accountMode: "live"` is refused outright (403), not silently downgraded.
 *   3. A live/unknown MT5 account is refused (403); only PAPER accounts work.
 *   4. Another user's account id cannot be used (400).
 *   5. A created bot is always persisted as accountMode "demo".
 *   6. Listing is owner-scoped.
 *   7. Reading or reconfiguring another owner's scalping bot returns 404.
 */

import { GET as listBots, POST as createBot } from "@/app/api/bot-studio/scalping/bots/route";
import { GET as getReport, PATCH as patchBot } from "@/app/api/bot-studio/scalping/bots/[botId]/route";
// Shared in-memory RTDB surface; jiti aliases the firebase-admin namespaces
// to this same stub for security suites.
import { rtDbStore } from "./firebase-admin-stub";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

function signToken(uid: string): string {
    const payload = JSON.stringify({ sub: uid, role: uid === "superAdmin" ? "admin" : "customer" });
    return `fake-token-${uid}.${btoa(payload)}.sig`;
}

function request(uid: string | null, body?: unknown) {
    return {
        headers: { get: (name: string) => (name === "authorization" && uid ? `Bearer ${signToken(uid)}` : null) },
        json: async () => body ?? {},
    } as unknown as Request;
}

const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });

const DEMO_ACCOUNT = {
    accountId: "gateway_5001",
    mt5Account: "5001",
    server: "MetaQuotes-Demo",
    broker: "MetaQuotes",
    balance: 10_000,
    equity: 10_000,
    status: "connected",
};

const LIVE_ACCOUNT = {
    accountId: "gateway_9001",
    mt5Account: "9001",
    server: "ICMarkets-Live01",
    broker: "ICMarkets",
    balance: 10_000,
    equity: 10_000,
    status: "connected",
};

function seed(): void {
    rtDbStore.clear();

    rtDbStore.set("users/proUser/role", "customer");
    rtDbStore.set("users/proUser/subscription", { plan: "pro", status: "active" });
    rtDbStore.set("users/otherProUser/role", "customer");
    rtDbStore.set("users/otherProUser/subscription", { plan: "pro", status: "active" });
    rtDbStore.set("users/freeUser/role", "customer");
    rtDbStore.set("users/superAdmin/role", "admin");

    // Owned accounts
    rtDbStore.set("trading_accounts/proUser/gateway_5001", DEMO_ACCOUNT);
    rtDbStore.set("trading_accounts/proUser/gateway_9001", LIVE_ACCOUNT);
    rtDbStore.set("trading_accounts/otherProUser/gateway_5002", {
        ...DEMO_ACCOUNT,
        accountId: "gateway_5002",
        mt5Account: "5002",
    });

    // A scalping bot owned by another Pro user.
    rtDbStore.set("bot_strategies/STRAT_THEIRS", {
        id: "STRAT_THEIRS",
        authorId: "otherProUser",
        name: "Their scalper",
        state: "valid",
        magicNumber: 123456789,
        definition: {
            asset: "EURUSD",
            timeframes: { setup: "M5" },
            direction: "long",
        },
        scalpingConfig: { direction: "both", preset: "balanced", symbol: "EURUSD", timeframe: "M5" },
    });
    rtDbStore.set("bot_deployments/BOT_THEIRS", {
        id: "BOT_THEIRS",
        strategyId: "STRAT_THEIRS",
        ownerId: "otherProUser",
        mt5Account: "gateway_5002",
        accountMode: "demo",
        runtimeState: "stopped",
        desiredState: "stopped",
        signalCount: 0,
        executionCount: 0,
        rejectionCount: 0,
        createdAt: 1,
        updatedAt: 1,
    });
    rtDbStore.set("bot_deployments_index/otherProUser/BOT_THEIRS", true);
}

async function run(): Promise<void> {
    console.log("Running scalping bot authorization tests...\n");
    seed();

    // ── 1. Entitlement gate ────────────────────────────────────────────────
    const free = await createBot(
        request("freeUser", { mt5Account: "gateway_5001", config: { preset: "balanced" } }) as never,
    );
    assert(free.status === 401, `non-Pro create must be 401 (got ${free.status})`);

    const anon = await createBot(request(null, {}) as never);
    assert(anon.status === 401, `anonymous create must be 401 (got ${anon.status})`);

    const freeList = await listBots(request("freeUser") as never);
    assert(freeList.status === 401, `non-Pro list must be 401 (got ${freeList.status})`);
    console.log("  ✓ Non-Pro / anonymous callers rejected.");

    // ── 2. Live mode is refused, never downgraded ──────────────────────────
    const liveMode = await createBot(
        request("proUser", { mt5Account: "gateway_5001", accountMode: "live", config: { preset: "balanced" } }) as never,
    );
    assert(liveMode.status === 403, `accountMode live must be 403 (got ${liveMode.status})`);

    // ── 3. Live account is refused ─────────────────────────────────────────
    const liveAccount = await createBot(
        request("proUser", { mt5Account: "gateway_9001", config: { preset: "balanced" } }) as never,
    );
    assert(liveAccount.status === 403, `live account must be 403 (got ${liveAccount.status})`);

    // ── 4. Another user's account cannot be used ───────────────────────────
    const foreignAccount = await createBot(
        request("proUser", { mt5Account: "gateway_5002", config: { preset: "balanced" } }) as never,
    );
    assert(foreignAccount.status === 400, `foreign account must be 400 (got ${foreignAccount.status})`);

    // ── 5. Invalid config is rejected ──────────────────────────────────────
    const badConfig = await createBot(
        request("proUser", { mt5Account: "gateway_5001", config: { symbol: "NOPE", direction: "up" } }) as never,
    );
    assert(badConfig.status === 400, `invalid config must be 400 (got ${badConfig.status})`);
    console.log("  ✓ Live mode/account, foreign account and invalid config refused.");

    // ── 6. Demo creation always persists accountMode "demo" ────────────────
    const created = await createBot(
        request("proUser", {
            name: "Test scalper",
            mt5Account: "gateway_5001",
            accountMode: "demo",
            config: {
                preset: "balanced",
                direction: "both",
                symbol: "XAUUSD",
                timeframe: "M5",
                riskPerTradePercent: 50, // must be clamped, not honoured
                maxSpreadPips: 500,
            },
        }) as never,
    );
    const body = (await created.json()) as {
        ok: boolean;
        deployment: { id: string; accountMode: string; mt5Account: string };
        strategy: { id: string; scalpingConfig: { riskPerTradePercent: number; maxSpreadPips: number } };
    };
    assert(created.status === 200 && body.ok, `demo creation must succeed (got ${created.status})`);
    assert(body.deployment.accountMode === "demo", "created bot must be demo");
    assert(body.deployment.mt5Account.startsWith("gateway_"), "account key normalised");
    assert(body.strategy.scalpingConfig.riskPerTradePercent <= 2, "risk clamped server-side");
    assert(body.strategy.scalpingConfig.maxSpreadPips <= 15, "spread clamped server-side");

    // Strategy/deployment persisted through the real DB helpers.
    assert(rtDbStore.has(`bot_deployments/${body.deployment.id}`), "deployment persisted");
    assert(rtDbStore.has(`bot_strategies/${body.strategy.id}`), "strategy persisted");
    console.log("  ✓ Demo bot created, values clamped, accountMode forced to demo.");

    // ── 7. Listing is owner-scoped ─────────────────────────────────────────
    const mine = await listBots(request("proUser") as never);
    const mineBody = (await mine.json()) as { bots: Array<{ deployment: { id: string } }> };
    assert(
        mineBody.bots.length === 1 && mineBody.bots[0].deployment.id === body.deployment.id,
        `list must only contain own bot (saw ${mineBody.bots.map((b) => b.deployment.id).join(",")})`,
    );

    const theirs = await listBots(request("otherProUser") as never);
    const theirsBody = (await theirs.json()) as { bots: Array<{ deployment: { id: string } }> };
    assert(
        theirsBody.bots.length === 1 && theirsBody.bots[0].deployment.id === "BOT_THEIRS",
        "peer must only see own bot",
    );
    console.log("  ✓ Bot listing is owner-scoped.");

    // ── 8. Cross-owner read / reconfigure is 404 ───────────────────────────
    const foreignReport = (await getReport(request("proUser") as never, ctx("BOT_THEIRS")))!;
    assert(foreignReport.status === 404, `foreign report must be 404 (got ${foreignReport.status})`);

    const foreignPatch = (await patchBot(
        request("proUser", { config: { preset: "active" } }) as never,
        ctx("BOT_THEIRS"),
    ))!;
    assert(foreignPatch.status === 404, `foreign patch must be 404 (got ${foreignPatch.status})`);

    const theirsStored = rtDbStore.get("bot_strategies/STRAT_THEIRS") as { scalpingConfig?: { preset?: string } };
    assert(theirsStored.scalpingConfig?.preset === "balanced", "foreign patch must not mutate the strategy");
    console.log("  ✓ Cross-owner read and write are refused as 404.");

    // ── 9. Own report is readable from persisted state only ────────────────
    const ownReport = (await getReport(request("proUser") as never, ctx(body.deployment.id)))!;
    const reportBody = (await ownReport.json()) as {
        ok: boolean;
        report: { performance: { paper: null; demo: { available: boolean } }; methodologies: unknown[] };
    };
    assert(ownReport.status === 200 && reportBody.ok, `own report must be 200 (got ${ownReport.status})`);
    assert(reportBody.report.performance.paper === null, "paper results are null, not a fabricated number");
    assert(reportBody.report.performance.demo.available === false, "no deals → demo performance unavailable");
    assert(reportBody.report.methodologies.length > 0, "methodology trace included");
    console.log("  ✓ Own report reads persisted records only (paper = null).");

    // ── 10. Running bot cannot be reconfigured mid-flight ─────────────────
    rtDbStore.set(`bot_deployments/${body.deployment.id}`, {
        ...(rtDbStore.get(`bot_deployments/${body.deployment.id}`) as object),
        runtimeState: "running",
        desiredState: "running",
    });
    const lockedPatch = (await patchBot(
        request("proUser", { config: { preset: "active" } }) as never,
        ctx(body.deployment.id),
    ))!;
    assert(lockedPatch.status === 409, `running bot patch must be 409 (got ${lockedPatch.status})`);
    console.log("  ✓ A running bot refuses configuration changes.");

    console.log("\nAll scalping bot authorization tests passed.\n");
}

await run();
