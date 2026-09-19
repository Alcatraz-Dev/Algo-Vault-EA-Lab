import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { syncBotStatuses } from "@/lib/bots";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();
        const broker = String(body.broker || body.company || "").trim();
        const server = String(body.server || "").trim();
        const balance = Number(body.balance || 0);
        const equity = Number(body.equity || 0);
        const margin = Number(body.margin || 0);
        const freeMargin = Number(body.freeMargin || 0);
        const marginLevel = Number(body.marginLevel || 0);
        const positionsCount = Number(body.positions || body.positionsCount || 0);
        const pendingOrdersCount = Number(body.orders || body.pendingOrdersCount || 0);

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and accountNumber are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { success: false, error: "Invalid gateway token." },
                { status: 403, headers: corsHeaders }
            );
        }

        const userId = gatewayUser.userId;

        const licensesSnap = await adminDatabase
            .ref(`trading_access/${userId}`)
            .get();

        const licenses = licensesSnap.val() || {};
        const now = Date.now();
        let hasActiveLicense = false;

        for (const [, raw] of Object.entries(licenses)) {
            if (!raw || typeof raw !== "object") continue;
            const license = raw as Record<string, unknown>;
            if (license.status === "active" && Number(license.expiresAt || 0) > now) {
                hasActiveLicense = true;
                break;
            }
        }

        // Custom-bot entitlement also authorizes the gateway (active Pro
        // subscription + active custom-bot license record).
        if (!hasActiveLicense) {
            const customLicensesSnap = await adminDatabase
                .ref(`licenses/${userId}`)
                .get();
            const allLicenses = customLicensesSnap.val() || {};
            for (const [, raw] of Object.entries(allLicenses)) {
                if (!raw || typeof raw !== "object") continue;
                const license = raw as Record<string, unknown>;
                if (license.type === "custom_bot" && license.status === "active") {
                    hasActiveLicense = true;
                    break;
                }
            }
        }

        if (!hasActiveLicense) {
            await adminDatabase
                .ref(`trading_accounts/${userId}/gateway_${accountNumber}/status`)
                .set("license_expired");

            return NextResponse.json(
                { success: false, error: "Trading access license expired.", status: "license_expired" },
                { status: 403, headers: corsHeaders }
            );
        }

        const accountId = `gateway_${accountNumber}`;
        const gatewayInstallationId = String(body.gatewayInstallationId || body.installationId || "").trim();
        const botsReported = Array.isArray(body.bots) ? body.bots : [];
        const terminalStatus = String(body.terminalStatus || body.status || "").trim();
        const gatewayVersion = String(body.gatewayVersion || body.eaVersion || "").trim();

        const accountUpdate: Record<string, unknown> = {
            balance,
            equity,
            margin,
            freeMargin,
            marginLevel,
            positionsCount,
            pendingOrdersCount,
            broker,
            server,
            status: "connected",
            lastHeartbeatAt: now,
            gatewayInstallationId: gatewayInstallationId || null,
            updatedAt: now,
        };
        if (gatewayVersion) accountUpdate.gatewayVersion = gatewayVersion;

        await adminDatabase
            .ref(`trading_accounts/${userId}/${accountId}`)
            .update(accountUpdate);

        if (gatewayInstallationId) {
            await adminDatabase
                .ref(`gateway_installations/${gatewayInstallationId}`)
                .update({
                    userId,
                    accountNumber,
                    accountId,
                    broker,
                    server,
                    terminalStatus: terminalStatus || "running",
                    status: "online",
                    lastHeartbeatAt: now,
                    updatedAt: now,
                });
        }

        await syncBotStatuses(userId, accountNumber, gatewayInstallationId, botsReported, now);

        // ── Copy trading: expose this account as a master ─────────────────
        // The AlgoVaultTradeGateway EA heartbeats into `trading_accounts`, but
        // copy-trading discovery reads `live_accounts`. Upsert the gateway
        // account there so it appears in the master marketplace (once the owner
        // flips the allow-copy-trading toggle in the account page). Existing
        // copy-trading state (toggle + admin overrides + stats) is preserved.
        const liveRef = adminDatabase.ref(`live_accounts/${accountId}`);
        const liveExisting = (await liveRef.get()).val() || {};

        const peakEquity = Math.max(Number(liveExisting.peakEquity || 0), equity);
        const drawdown =
            peakEquity > 0 ? Math.round(((peakEquity - equity) / peakEquity) * 10000) / 100 : 0;

        await liveRef.set({
            ownerUid: userId,
            userId,
            mt5Account: accountNumber,
            broker,
            server,
            balance,
            equity,
            floatingProfit: Number(liveExisting.floatingProfit || 0) || Math.max(0, equity - balance),
            peakEquity,
            drawdown,
            status: "online",
            allowCopyTrading: liveExisting.allowCopyTrading === true,
            copyTradingOverride: liveExisting.copyTradingOverride || null,
            productId: liveExisting.productId || null,
            productName: liveExisting.productName || null,
            stats: {
                ...((liveExisting.stats as Record<string, unknown>) || {}),
                drawdown: Math.round(drawdown * 100) / 100,
            },
            lastHeartbeatAt: now,
            createdAt: liveExisting.createdAt || now,
            updatedAt: now,
        });

        // Fetch-all + filter: avoids requiring a `trading_order_requests` RTDB
        // index on `accountId` (consistent with the commands route).
        const commandsSnap = await adminDatabase
            .ref(`trading_order_requests/${userId}`)
            .get();

        const commandsData = commandsSnap.val() || {};
        const pendingCommands: Array<Record<string, unknown>> = [];

        for (const [commandId, raw] of Object.entries(commandsData)) {
            if (!raw || typeof raw !== "object") continue;
            const cmd = raw as Record<string, unknown>;
            if (cmd.status === "queued" && String(cmd.accountId || "") === accountId) {
                pendingCommands.push({ ...cmd, id: commandId });
            }
        }

        return NextResponse.json(
            { success: true, commands: pendingCommands },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/heartbeat POST]", error);
        return NextResponse.json(
            { success: false, error: "Heartbeat failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
