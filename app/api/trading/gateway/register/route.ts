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
        const currency = String(body.currency || "").trim();
        const leverage = String(body.leverage || "").trim();
        const balance = Number(body.balance || 0);
        const equity = Number(body.equity || 0);
        const gatewayVersion = String(body.gatewayVersion || body.eaVersion || "").trim();

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { authorized: false, error: "gatewayToken and accountNumber are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { authorized: false, error: "Invalid gateway token." },
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

        // Custom-bot entitlement grants gateway access too: users who connect
        // their own EA on an active Pro subscription get an extended license
        // record (licenses/{uid}/{botId}-LIC, type "custom_bot"). Custom
        // entitlements have no hard expiry (valid while the Pro subscription
        // is active), so only status is checked here.
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
            return NextResponse.json(
                { authorized: false, error: "No active trading access license.", status: "license_expired" },
                { status: 403, headers: corsHeaders }
            );
        }

        const accountId = `gateway_${accountNumber}`;
        const existingSnap = await adminDatabase
            .ref(`trading_accounts/${userId}/${accountId}`)
            .get();

        const existing = existingSnap.val();

        const gatewayInstallationId = String(body.gatewayInstallationId || body.installationId || "").trim();
        const botsReported = Array.isArray(body.bots) ? body.bots : [];
        const magicNumber = String(body.magicNumber || "").trim();

        const accountData = {
            accountId,
            userId,
            mt5Account: accountNumber,
            broker,
            server,
            currency,
            leverage,
            balance,
            equity,
            status: "connected" as const,
            lastHeartbeatAt: now,
            gatewayVersion,
            magicNumber: magicNumber || existing?.magicNumber || null,
            gatewayInstallationId: gatewayInstallationId || existing?.gatewayInstallationId || null,
            connectedAt: existing?.connectedAt || now,
            updatedAt: now,
        };

        await adminDatabase
            .ref(`trading_accounts/${userId}/${accountId}`)
            .set(accountData);

        if (gatewayInstallationId) {
            const installation = {
                userId,
                accountNumber,
                accountId,
                broker,
                server,
                gatewayVersion,
                status: "connected",
                lastHeartbeatAt: now,
                updatedAt: now,
            } as Record<string, unknown>;
            if (!existing) installation.registeredAt = now;
            await adminDatabase
                .ref(`gateway_installations/${gatewayInstallationId}`)
                .update(installation);
        }

        // Mark any matching bots online.
        await syncBotStatuses(userId, accountNumber, gatewayInstallationId, botsReported, now);

        return NextResponse.json(
            { authorized: true, accountId, status: "connected" },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/register POST]", error);
        return NextResponse.json(
            { authorized: false, error: "Registration failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
