import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { isCopyTradingEnabled, listMarketplaceMasters } from "@/lib/copy-trading";

export const runtime = "nodejs";

/**
 * GET /api/copy-trading/marketplace
 *
 * Public discovery endpoint. Returns masters eligible to be copied.
 * Authenticated users also receive their own follower config IDs so the UI
 * can show "Following" vs "Start Copying".
 */
export async function GET(request: NextRequest) {
    try {
        const search = new URL(request.url).searchParams.get("search") || undefined;
        const broker = new URL(request.url).searchParams.get("broker") || undefined;
        const minFollowers = Number(new URL(request.url).searchParams.get("minFollowers") || 0);
        const limit = Number(new URL(request.url).searchParams.get("limit") || 50);

        const token = await authenticate(request);
        const uid = token?.uid;

        const [enabled, masters, userConfigsSnap, gatewayAccountsSnap] = await Promise.all([
            isCopyTradingEnabled(),
            listMarketplaceMasters({ search, broker, minFollowers, limit }),
            uid ? adminDatabase.ref(`copy_trading/${uid}`).get() : Promise.resolve({ val: () => ({}) }),
            uid ? adminDatabase.ref(`trading_accounts/${uid}`).get() : Promise.resolve({ val: () => ({}) }),
        ]);

        const userConfigs = userConfigsSnap.val() || {};
        const followingByMaster: Record<string, string[]> = {};
        for (const configId of Object.keys(userConfigs)) {
            const cfg = userConfigs[configId];
            if (!cfg) continue;
            const masterKey = String(cfg.masterId ?? cfg.masterMt5Account ?? "");
            if (masterKey) {
                if (!followingByMaster[masterKey]) followingByMaster[masterKey] = [];
                followingByMaster[masterKey].push(configId);
            }
        }

        // Connected gateway accounts owned by this user that are NOT currently
        // listed, so the owner can see why (no copy-trading entry yet, opted
        // out, or offline) and act on it.
        const gatewayAccounts = gatewayAccountsSnap.val() || {};
        const liveSnap = uid
            ? await adminDatabase.ref("live_accounts").get()
            : { val: () => ({}) };
        const liveAccounts = liveSnap.val() || {};
        const unlistedMasters: Array<{
            id: string;
            liveAccountId: string | null;
            mt5Account: string;
            online: boolean;
            allowCopyTrading: boolean;
            reason: string;
        }> = [];

        if (uid) {
            for (const accountId of Object.keys(gatewayAccounts)) {
                if (!accountId.startsWith("gateway_")) continue;
                const mt5Account = accountId.slice("gateway_".length);
                const live = liveAccounts[accountId] as Record<string, unknown> | undefined;
                const liveOnline = Boolean(
                    live?.lastHeartbeatAt &&
                        Date.now() - Number(live.lastHeartbeatAt) < 60_000
                );

                if (live && (liveOnline ? live.allowCopyTrading === true : true)) continue;

                let reason = "live_accounts entry not synced yet (heartbeat pending)";
                if (live && !liveOnline) reason = "offline (no heartbeat in last 60s)";
                else if (live && live.allowCopyTrading !== true) reason = "copy trading not enabled for this account";

                unlistedMasters.push({
                    id: accountId,
                    liveAccountId: live ? accountId : null,
                    mt5Account,
                    online: liveOnline,
                    allowCopyTrading: live?.allowCopyTrading === true,
                    reason,
                });
            }
        }

        return NextResponse.json({
            enabled,
            masters: masters.map((m) => ({
                ...m,
                isFollowing: (followingByMaster[m.id] || []).length > 0,
                followingConfigIds: followingByMaster[m.id] || [],
            })),
            unlistedMasters,
            generatedAt: Date.now(),
        });
    } catch (error) {
        console.error("COPY-TRADING MARKETPLACE API ERROR:", error);
        return NextResponse.json({ error: "Failed to load marketplace." }, { status: 500 });
    }
}