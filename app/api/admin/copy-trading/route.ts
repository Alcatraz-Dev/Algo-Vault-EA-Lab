import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    countActiveConnections,
    isCopyTradingEnabled,
    resolveMasterEligibility,
} from "@/lib/copy-trading";

export const runtime = "nodejs";

/**
 * GET /api/admin/copy-trading
 *
 * Returns the global feature switch, every live account with its resolved
 * eligibility, and aggregate connection metrics.
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const [enabled, connections, accountsSnap] = await Promise.all([
            isCopyTradingEnabled(),
            countActiveConnections(),
            adminDatabase.ref("live_accounts").get(),
        ]);

        const accounts = accountsSnap.val() || {};
        const list: Array<{
            id: string;
            ownerUid: string | null;
            productId: string | null;
            productName: string | null;
            mt5Account: string | number | null;
            broker: string | null;
            server: string | null;
            balance: number;
            equity: number;
            online: boolean;
            lastHeartbeatAt: number | null;
            allowCopyTrading: boolean;
            override: Record<string, unknown> | null;
            eligibility: Awaited<ReturnType<typeof resolveMasterEligibility>>;
        }> = [];

        for (const [accountId, raw] of Object.entries(accounts)) {
            const acct = (raw as Record<string, unknown>) || {};
            const eligibility = await resolveMasterEligibility(
                accountId,
                (acct.ownerUid as string | undefined) ?? null
            );
            list.push({
                id: accountId,
                ownerUid: (acct.ownerUid as string | undefined) ?? null,
                productId: (acct.productId as string | undefined) ?? null,
                productName: (acct.productName as string | undefined) ?? null,
                mt5Account: (acct.mt5Account as string | number | undefined) ?? null,
                broker: (acct.broker as string | undefined) ?? null,
                server: (acct.server as string | undefined) ?? null,
                balance: Number(acct.balance ?? 0),
                equity: Number(acct.equity ?? 0),
                online: Boolean(
                    acct.lastHeartbeatAt &&
                        Date.now() - Number(acct.lastHeartbeatAt) < 60_000
                ),
                lastHeartbeatAt: (acct.lastHeartbeatAt as number | undefined) ?? null,
                allowCopyTrading: Boolean(acct.allowCopyTrading),
                override: (acct.copyTradingOverride as Record<string, unknown> | undefined) ?? null,
                eligibility,
            });
        }

        return NextResponse.json({
            enabled,
            connections,
            accounts: list,
            generatedAt: Date.now(),
        });
    } catch (error) {
        console.error("ADMIN COPY-TRADING API ERROR:", error);
        return NextResponse.json({ error: "Failed to load copy trading data." }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/copy-trading
 *
 * Admin controls:
 *   { "global": true|false }            — toggle the platform-wide switch
 *   { "accountId": "...", ...overrides }— per-account override
 *   { "uid": "...", ...overrides }      — per-user override
 */
export async function PATCH(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        if (typeof body.global === "boolean") {
            await adminDatabase.ref("settings/copyTradingEnabled").set(Boolean(body.global));
        }

        if (body.accountId && typeof body.accountId === "string") {
            const updates: Record<string, unknown> = {};
            const keys: (keyof typeof body)[] = [
                "allowBeCopied",
                "allowBeFollowed",
                "isFollowingDisabled",
                "isBeingCopiedDisabled",
                "canBeListed",
            ];
            for (const key of keys) {
                const value = body[key];
                if (typeof value === "boolean") {
                    updates[`copyTradingOverride/${key}`] = value;
                }
            }
            if (Object.keys(updates).length > 0) {
                await adminDatabase.ref(`live_accounts/${body.accountId}`).update(updates);
            }
        }

        if (body.uid && typeof body.uid === "string") {
            const updates: Record<string, unknown> = {};
            const keys: (keyof typeof body)[] = [
                "isFollowingDisabled",
                "isBeingCopiedDisabled",
            ];
            for (const key of keys) {
                const value = body[key];
                if (typeof value === "boolean") {
                    updates[`copyTradingOverride/${key}`] = value;
                }
            }
            if (Object.keys(updates).length > 0) {
                await adminDatabase.ref(`users/${body.uid}`).update(updates);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("ADMIN COPY-TRADING PATCH ERROR:", error);
        return NextResponse.json({ error: "Failed to update copy trading settings." }, { status: 500 });
    }
}
