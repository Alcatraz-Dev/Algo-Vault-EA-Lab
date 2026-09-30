import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { newClientOrderId } from "@/lib/gateway";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
    });
}

export async function POST(request: NextRequest) {
    try {
        // Auth-first (§O): this route queues real MT5 orders in mt5_orders/ and
        // live_positions/ — it must never run unauthenticated. The trading
        // account is resolved from the caller's connected accounts, never from
        // the request body.
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401, headers: corsHeaders }
            );
        }

        const body = await request.json().catch(() => ({}));
        const {
            signalId,
            symbol,
            direction,
            volume = 0.10,
            entryPrice,
            stopLoss,
            takeProfit,
            productId: productIdFromBody,
        } = body;

        if (!symbol || !direction) {
            return NextResponse.json(
                { success: false, error: "Symbol and Direction are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        // Resolve the caller's connected MT5 accounts — an attacker can no
        // longer target an arbitrary account by passing `mt5Account`.
        const accountsSnap = await adminDatabase.ref(`trading_accounts/${user.uid}`).get();
        let mt5Account: string | null = null;
        if (accountsSnap.exists()) {
            accountsSnap.forEach((child) => {
                const acct = child.val() as { status?: string; mt5Account?: string; accountId?: string } | null;
                if (mt5Account) return;
                if (acct && acct.status === "connected") {
                    mt5Account = String(acct.mt5Account ?? acct.accountId ?? "");
                }
            });
        }
        if (!mt5Account) {
            return NextResponse.json(
                { success: false, error: "No connected MT5 account found. Connect one via Account → Trading Access first." },
                { status: 400, headers: corsHeaders }
            );
        }

        // Auto-resolve productId from licenses (the caller's own account, so
        // this only ever scopes the position under a product the caller owns).
        let resolvedProductId: string | undefined = productIdFromBody;
        if (!resolvedProductId && mt5Account) {
            const licensesSnap = await adminDatabase.ref("licenses").once("value");
            const licensesData = licensesSnap.val() || {};
            for (const uId of Object.keys(licensesData)) {
                for (const lId of Object.keys(licensesData[uId] || {})) {
                    const lic = licensesData[uId][lId];
                    if (lic && String(lic.mt5Account) === String(mt5Account) && lic.productId) {
                        resolvedProductId = lic.productId;
                        break;
                    }
                }
                if (resolvedProductId) break;
            }
        }

        const ticket = newClientOrderId("ord");
        const now = Date.now();
        const primaryAccountId = resolvedProductId ? `${resolvedProductId}_${mt5Account}` : `live_${mt5Account}`;
        const fallbackAccountId = `live_${mt5Account}`;

        const newPosition = {
            ticket,
            symbol: String(symbol).replace("/", ""),
            type: String(direction).toUpperCase(),
            volume: Number(volume),
            openPrice: Number(entryPrice),
            currentPrice: Number(entryPrice),
            stopLoss: Number(stopLoss),
            takeProfit: takeProfit ? Number(takeProfit) : 0,
            profit: 0.00,
            swap: 0.00,
            magic: 888999,
            source: "AI Signal Engine",
            signalId: signalId || "sig_ai",
            openedAt: now,
            lastSeenAt: now,
            updatedAt: now,
        };

        // Write trade signal position to live_positions for both primary and fallback account paths
        await adminDatabase
            .ref(`live_positions/${primaryAccountId}/${ticket}`)
            .set(newPosition);

        if (primaryAccountId !== fallbackAccountId) {
            await adminDatabase
                .ref(`live_positions/${fallbackAccountId}/${ticket}`)
                .set(newPosition);
        }

        // Record in trade queue for MT5 execution bridge
        await adminDatabase
            .ref(`mt5_orders/${mt5Account}/${ticket}`)
            .set({
                ...newPosition,
                status: "PENDING_MT5_EXECUTION",
            });

        return NextResponse.json(
            {
                success: true,
                ticket,
                accountId: primaryAccountId,
                mt5Account,
                position: newPosition,
                message: `Order ${ticket} (${symbol} ${direction}) submitted to gateway for MT5 Account ${mt5Account} — awaiting execution`,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("SIGNAL EXECUTION ERROR:", err);
        return NextResponse.json(
            { success: false, error: err instanceof Error ? err.message : "Failed to execute signal on MT5" },
            { status: 500, headers: corsHeaders }
        );
    }
}
