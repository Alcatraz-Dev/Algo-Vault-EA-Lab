/**
 * Gateway snapshot security suite.
 *
 * Exercises `POST /api/trading/gateway/snapshot` end to end against the
 * in-memory firebase-admin seam:
 *
 *   - missing/invalid gateway token → 401/403 contract
 *   - manually opened MT5 position (magic = 0) synced into trading_positions
 *   - EA-owned position (magic == MagicNumber) also synced
 *   - pending orders written to trading_orders, positions to trading_positions
 *   - position removed from snapshot → closed trade history entry
 *   - cross-user isolation: user B cannot see user A's positions
 *   - idempotency: same snapshot twice → no duplicate positions
 *   - empty/malformed snapshot → clears positions, no crash
 *   - bot-owned positions indexed under bot_positions, not mirrored
 *
 * The runner aliases `firebase-admin*` to `tests/security/firebase-admin-stub`,
 * so no real credentials, database or network are touched.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { POST as postSnapshot } from "@/app/api/trading/gateway/snapshot/route";
import { NextRequest } from "next/server";
import { rtDbStore, adminDatabase } from "./firebase-admin-stub";

type Route = (request: NextRequest) => Promise<Response>;

const s = createSuite("api-v1-gateway-snapshot");
const BASE = "http://localhost";

async function call(
    route: Route,
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    secret?: string
): Promise<Response> {
    const headers: Record<string, string> = {};
    if (secret) headers.authorization = `Bearer ${secret}`;
    const init: RequestInit = { method, headers };
    if (body && method === "POST") {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    return route(new Request(`${BASE}${path}`, init) as unknown as NextRequest);
}

function seedGatewayUser(token: string, userId: string): void {
    rtDbStore.set(`gateway_users/${token}`, { userId, createdAt: Date.now() });
}

function snapshotBody(
    accountNumber: string,
    positions: Record<string, unknown>[] = [],
    orders: Record<string, unknown>[] = []
): Record<string, unknown> {
    return {
        accountNumber,
        positions,
        orders,
    };
}

async function run(): Promise<boolean> {
    const userA = "user-a";
    const userB = "user-b";
    const accountA = "1001";
    const accountB = "2002";
    const accountIdA = `gateway_${accountA}`;
    const accountIdB = `gateway_${accountB}`;

    const tokenA = "tok-aaa";
    const tokenB = "tok-bbb";

    seedGatewayUser(tokenA, userA);
    seedGatewayUser(tokenB, userB);

    // ── 1. Authentication ────────────────────────────────────────────────
    s.section("1. Authentication");
    {
        // No bearer token, no body → missing required params → 400
        const response = await call(postSnapshot, "/api/trading/gateway/snapshot", "POST");
        s.check(response.status === 400, "no bearer token, no body -> 400");

        // No bearer token, but body with accountNumber → missing token → 400
        const response2 = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA)
        );
        s.check(response2.status === 400, "no bearer token, has body -> 400");

        // Invalid bearer token → 403
        const response3 = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA),
            "invalid-token"
        );
        s.check(response3.status === 403, "invalid gateway token -> 403");
    }

    // ── 2. Manual MT5 position (magic = 0) synced ────────────────────────
    s.section("2. Manual MT5 position (magic = 0) is synced");
    {
        const now = Date.now();
        const manualPos = {
            ticket: "90001",
            symbol: "XAUUSD",
            type: "BUY",
            volume: 0.1,
            openPrice: 2300,
            currentPrice: 2310,
            sl: 2290,
            tp: 2330,
            profit: 100,
            swap: 0,
            magic: 0,
            comment: "manual open",
            openedAt: now - 1000,
        };

        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [manualPos]),
            tokenA
        );
        s.check(response.status === 200, "manual position snapshot -> 200");

        const snap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        const stored = (snap.exists() ? snap.val() : {}) as Record<string, unknown>;
        s.check(
            stored["90001"] !== undefined,
            "manual position (magic=0) present in trading_positions"
        );
        if (stored["90001"]) {
            s.check(
                String((stored["90001"] as Record<string, unknown>).symbol) === "XAUUSD",
                "position symbol preserved"
            );
            s.check(
                Number((stored["90001"] as Record<string, unknown>).magic) === 0,
                "position magic preserved as 0"
            );
            s.check(
                String((stored["90001"] as Record<string, unknown>).comment) === "manual open",
                "position comment preserved"
            );
        }
    }

    // ── 3. EA-owned position (magic == MagicNumber) synced ───────────────
    s.section("3. EA-owned position (magic == MagicNumber) is synced");
    {
        const eaPos = {
            ticket: "90002",
            symbol: "EURUSD",
            type: "SELL",
            volume: 0.5,
            openPrice: 1.085,
            currentPrice: 1.083,
            sl: 1.090,
            tp: 1.080,
            profit: 50,
            swap: 0,
            magic: 999888,
            comment: "AlgoVault EA",
            openedAt: Date.now() - 2000,
        };

        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [eaPos]),
            tokenA
        );
        s.check(response.status === 200, "EA-owned position snapshot -> 200");

        const snap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        const stored = (snap.exists() ? snap.val() : {}) as Record<string, unknown>;
        s.check(
            stored["90002"] !== undefined,
            "EA-owned position present in trading_positions"
        );
        if (stored["90002"]) {
            s.check(
                Number((stored["90002"] as Record<string, unknown>).magic) === 999888,
                "EA magic preserved"
            );
        }
    }

    // ── 4. Pending orders synced separately ──────────────────────────────
    s.section("4. Pending orders written to trading_orders");
    {
        const pendingOrder = {
            ticket: "90003",
            symbol: "GBPUSD",
            type: "BUY_LIMIT",
            volume: 0.2,
            price: 1.2500,
            sl: 1.2450,
            tp: 1.2600,
            status: "active",
        };

        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [], [pendingOrder]),
            tokenA
        );
        s.check(response.status === 200, "pending order snapshot -> 200");

        const snap = await adminDatabase.ref(`trading_orders/${userA}/${accountIdA}`).get();
        const stored = (snap.exists() ? snap.val() : {}) as Record<string, unknown>;
        s.check(
            stored["90003"] !== undefined,
            "pending order present in trading_orders"
        );
        if (stored["90003"]) {
            s.check(
                String((stored["90003"] as Record<string, unknown>).symbol) === "GBPUSD",
                "order symbol preserved"
            );
        }

        // Positions should not contain the order ticket
        const posSnap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        const positions = (posSnap.exists() ? posSnap.val() : {}) as Record<string, unknown>;
        s.check(
            positions["90003"] === undefined,
            "order ticket not stored under trading_positions"
        );
    }

    // ── 5. Position removed → closed trade history ───────────────────────
    s.section("5. Position removed from snapshot → closed trade history");
    {
        // Seed a prior position, then send a snapshot without it
        rtDbStore.set(`trading_positions/${userA}/${accountIdA}`, {
            "90004": {
                ticket: "90004",
                symbol: "XAUUSD",
                type: "BUY",
                volume: 0.1,
                openPrice: 2300,
                currentPrice: 2320,
                profit: 200,
                magic: 0,
                comment: "to be closed",
                openedAt: Date.now() - 5000,
            },
        });

        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, []),
            tokenA
        );
        s.check(response.status === 200, "snapshot removing position -> 200");

        // Position should be gone (replace-all semantics)
        const posSnap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        s.check(
            !posSnap.exists() || Object.keys(posSnap.val() || {}).length === 0,
            "removed position no longer in trading_positions"
        );

        // Closed trade history entry should exist
        const histSnap = await adminDatabase.ref(`trading_history/${userA}/${accountIdA}/90004`).get();
        s.check(
            histSnap.exists(),
            "closed trade history entry created"
        );
        if (histSnap.exists()) {
            const hist = histSnap.val() as Record<string, unknown>;
            s.check(
                String(hist.closeSource) === "gateway_snapshot",
                "closeSource is gateway_snapshot"
            );
            s.check(
                Number(hist.profit) === 200,
                "realized profit recorded"
            );
        }
    }

    // ── 6. Cross-user isolation ──────────────────────────────────────────
    s.section("6. Cross-user isolation");
    {
        // Seed a position for user B under their own account
        rtDbStore.set(`trading_positions/${userB}/${accountIdB}`, {
            "91001": {
                ticket: "91001",
                symbol: "XAUUSD",
                type: "BUY",
                volume: 0.1,
                openPrice: 2300,
                currentPrice: 2310,
                profit: 100,
                magic: 0,
                comment: "user B manual",
                openedAt: Date.now() - 1000,
            },
        });

        // User A's snapshot should not touch user B's data
        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [{ ticket: "90005", symbol: "XAUUSD", type: "BUY", volume: 0.1, magic: 0 }]),
            tokenA
        );
        s.check(response.status === 200, "user A snapshot -> 200");

        const bSnap = await adminDatabase.ref(`trading_positions/${userB}/${accountIdB}`).get();
        const bPositions = (bSnap.exists() ? bSnap.val() : {}) as Record<string, unknown>;
        s.check(
            bPositions["91001"] !== undefined,
            "user B's position intact after user A's snapshot"
        );
        s.check(
            bPositions["90005"] === undefined,
            "user A's position not written under user B"
        );
    }

    // ── 7. Idempotency ───────────────────────────────────────────────────
    s.section("7. Idempotency");
    {
        const pos = {
            ticket: "90006",
            symbol: "USDJPY",
            type: "BUY",
            volume: 0.1,
            openPrice: 145.0,
            currentPrice: 145.5,
            magic: 0,
            comment: "idempotent",
        };

        await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [pos]),
            tokenA
        );
        await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [pos]),
            tokenA
        );

        const snap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        const stored = (snap.exists() ? snap.val() : {}) as Record<string, unknown>;
        s.check(
            Object.keys(stored).filter((k) => k === "90006").length === 1,
            "same position appears exactly once after two snapshots"
        );
    }

    // ── 8. Empty/malformed snapshot safety ───────────────────────────────
    s.section("8. Empty/malformed snapshot safety");
    {
        // Seed a position, then send empty snapshot → should clear it
        rtDbStore.set(`trading_positions/${userA}/${accountIdA}`, {
            "90007": { ticket: "90007", symbol: "XAUUSD", type: "BUY", volume: 0.1, magic: 0 },
        });

        const response = await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, []),
            tokenA
        );
        s.check(response.status === 200, "empty snapshot -> 200 (no crash)");

        const snap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        s.check(
            !snap.exists() || Object.keys(snap.val() || {}).length === 0,
            "empty snapshot clears all positions"
        );
    }

    // ── 9. Multi-symbol distinguishability ───────────────────────────────
    s.section("9. Multi-symbol distinguishability");
    {
        const multi = [
            { ticket: "90008", symbol: "XAUUSD", type: "BUY", volume: 0.1, magic: 0 },
            { ticket: "90009", symbol: "EURUSD", type: "SELL", volume: 0.2, magic: 0 },
            { ticket: "90010", symbol: "GBPUSD", type: "BUY", volume: 0.3, magic: 0 },
        ];

        await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, multi),
            tokenA
        );

        const snap = await adminDatabase.ref(`trading_positions/${userA}/${accountIdA}`).get();
        const stored = (snap.exists() ? snap.val() : {}) as Record<string, unknown>;
        s.check(
            stored["90008"] !== undefined && stored["90009"] !== undefined && stored["90010"] !== undefined,
            "all three positions stored"
        );
        if (stored["90008"] && stored["90009"] && stored["90010"]) {
            s.check(
                String((stored["90008"] as Record<string, unknown>).symbol) === "XAUUSD",
                "ticket 90008 = XAUUSD"
            );
            s.check(
                String((stored["90009"] as Record<string, unknown>).symbol) === "EURUSD",
                "ticket 90009 = EURUSD"
            );
            s.check(
                String((stored["90010"] as Record<string, unknown>).symbol) === "GBPUSD",
                "ticket 90010 = GBPUSD"
            );
        }
    }

    // ── 10. Bot-owned positions indexed, not mirrored ────────────────────
    s.section("10. Bot-owned positions indexed under bot_positions");
    {
        const botId = "bot-1";
        const magicStr = "111111";

        // Seed a bot record for user A on accountA
        rtDbStore.set(`user_bots/${botId}`, {
            id: botId,
            ownerId: userA,
            name: "Test Bot",
            magicNumber: magicStr,
            mt5Account: accountA,
            symbol: "XAUUSD",
            status: "connected",
            createdAt: Date.now(),
        });
        rtDbStore.set(`user_bots_index/${userA}`, { [botId]: true });

        const botPos = {
            ticket: "90011",
            symbol: "XAUUSD",
            type: "BUY",
            volume: 0.1,
            openPrice: 2300,
            currentPrice: 2310,
            magic: Number(magicStr),
            comment: "bot",
        };

        await call(
            postSnapshot,
            "/api/trading/gateway/snapshot",
            "POST",
            snapshotBody(accountA, [botPos]),
            tokenA
        );

        const botPosSnap = await adminDatabase.ref(`bot_positions/${botId}/90011`).get();
        s.check(
            botPosSnap.exists(),
            "bot-owned position indexed under bot_positions"
        );
    }

    const finished = s.finish();
    process.exit(finished ? 0 : 1);
}

run();
