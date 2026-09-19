import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { countActiveConnections, isCopyTradingEnabled, resolveMasterEligibility } from "@/lib/copy-trading";

export const runtime = "nodejs";

function isOwnedBy(account: Record<string, unknown>, uid: string) {
    return account.ownerUid === uid || account.userId === uid;
}

function isOnline(account: Record<string, unknown>) {
    return Boolean(account.lastHeartbeatAt && Date.now() - Number(account.lastHeartbeatAt) < 120_000);
}

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const [enabled, accountsSnap, connections] = await Promise.all([
            isCopyTradingEnabled(),
            adminDatabase.ref("live_accounts").get(),
            countActiveConnections(),
        ]);

        const accounts = accountsSnap.val() || {};
        const owned = [];

        for (const [accountId, raw] of Object.entries(accounts as Record<string, Record<string, unknown>>)) {
            const account = raw || {};
            if (!isOwnedBy(account, token.uid)) continue;

            const eligibility = await resolveMasterEligibility(accountId, token.uid);
            owned.push({
                id: accountId,
                productId: account.productId || null,
                productName: account.productName || null,
                mt5Account: account.mt5Account || null,
                broker: account.broker || null,
                server: account.server || null,
                balance: Number(account.balance || 0),
                equity: Number(account.equity || 0),
                floatingProfit: Number(account.floatingProfit || 0),
                drawdown: Number(account.drawdown || 0),
                allowCopyTrading: account.allowCopyTrading === true,
                online: isOnline(account),
                lastHeartbeatAt: account.lastHeartbeatAt || null,
                stats: account.stats || null,
                copyTradingOverride: account.copyTradingOverride || null,
                eligibility,
                followerCount: connections.byMaster[accountId] || 0,
            });
        }

        owned.sort((a, b) => Number(b.lastHeartbeatAt || 0) - Number(a.lastHeartbeatAt || 0));

        return NextResponse.json({
            enabled,
            accounts: owned,
            generatedAt: Date.now(),
        });
    } catch (error) {
        console.error("COPY-TRADING MASTER GET ERROR:", error);
        return NextResponse.json({ error: "Failed to load master accounts." }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const accountId = String(body.accountId || "").trim();
        const allowCopyTrading = body.allowCopyTrading;

        if (!accountId || typeof allowCopyTrading !== "boolean") {
            return NextResponse.json({ error: "accountId and allowCopyTrading are required." }, { status: 400 });
        }

        const accountRef = adminDatabase.ref(`live_accounts/${accountId}`);
        const accountSnap = await accountRef.get();
        if (!accountSnap.exists()) {
            return NextResponse.json({ error: "Master account not found." }, { status: 404 });
        }

        const account = accountSnap.val() || {};
        if (!isOwnedBy(account, token.uid)) {
            return NextResponse.json({ error: "You can only update your own master account." }, { status: 403 });
        }

        if (allowCopyTrading && !(await isCopyTradingEnabled())) {
            return NextResponse.json({ error: "Copy trading is disabled platform-wide." }, { status: 403 });
        }

        const override = account.copyTradingOverride || {};
        if (
            allowCopyTrading &&
            (override.isBeingCopiedDisabled === true ||
                override.allowBeCopied === false ||
                override.allowBeFollowed === false ||
                override.canBeListed === false)
        ) {
            return NextResponse.json({ error: "This master account is restricted by admin controls." }, { status: 403 });
        }

        await accountRef.update({
            allowCopyTrading,
            updatedAt: Date.now(),
        });

        const eligibility = await resolveMasterEligibility(accountId, token.uid);
        return NextResponse.json({ success: true, eligibility });
    } catch (error) {
        console.error("COPY-TRADING MASTER PATCH ERROR:", error);
        return NextResponse.json({ error: "Failed to update master copy trading status." }, { status: 500 });
    }
}
