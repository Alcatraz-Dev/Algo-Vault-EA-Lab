import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import { verifyGatewayToken } from "@/lib/gateway";

export const runtime = "nodejs";

// ─── GET /api/trading/access/validate ───────────────────────────────────────

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { valid: false, error: "Unauthorized." },
            { status: 401 }
        );
    }

    try {
        const snapshot = await adminDatabase
            .ref(`trading_access/${token.uid}`)
            .get();

        const data = snapshot.val() || {};
        const now = Date.now();

        let bestLicense: Record<string, unknown> | null = null;

        for (const [licenseId, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== "object") continue;
            const license = raw as Record<string, unknown>;
            if (license.status === "active" && Number(license.expiresAt || 0) > now) {
                bestLicense = { ...license, id: licenseId };
                break;
            }
        }

        if (!bestLicense) {
            return NextResponse.json({
                valid: false,
                error: "No active trading access license found.",
            });
        }

        const accountsSnap = await adminDatabase
            .ref(`trading_accounts/${token.uid}`)
            .get();

        const accountsData = accountsSnap.val() || {};
        const connectedAccounts = Object.keys(accountsData).length;

        return NextResponse.json({
            valid: true,
            license: bestLicense,
            maxAccounts: Number(bestLicense.maxAccounts || 1),
            connectedAccounts,
        });
    } catch (error) {
        console.error("[trading/access/validate GET]", error);
        return NextResponse.json(
            { valid: false, error: "Validation failed." },
            { status: 500 }
        );
    }
}

// ─── POST /api/trading/access/validate ──────────────────────────────────────

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const bodyUserId = String(body.userId || "").trim();
        const gatewayToken = String(body.gatewayToken || "").trim();

        if (!gatewayToken) {
            return NextResponse.json(
                { valid: false, error: "gatewayToken is required." },
                { status: 400 }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { valid: false, error: "Invalid gateway token." },
                { status: 403 }
            );
        }

        const userId = gatewayUser.userId;

        // Reject if the caller provides a userId that doesn't match the token mapping.
        if (bodyUserId && bodyUserId !== userId) {
            return NextResponse.json(
                { valid: false, error: "Invalid gateway token." },
                { status: 403 }
            );
        }

        const snapshot = await adminDatabase
            .ref(`trading_access/${userId}`)
            .get();

        const data = snapshot.val() || {};
        const now = Date.now();

        let bestLicense: Record<string, unknown> | null = null;

        for (const [licenseId, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== "object") continue;
            const license = raw as Record<string, unknown>;
            if (license.status === "active" && Number(license.expiresAt || 0) > now) {
                bestLicense = { ...license, id: licenseId };
                break;
            }
        }

        if (!bestLicense) {
            return NextResponse.json({
                valid: false,
                error: "No active trading access license found.",
            });
        }

        const accountsSnap = await adminDatabase
            .ref(`trading_accounts/${userId}`)
            .get();

        const accountsData = accountsSnap.val() || {};
        const connectedAccounts = Object.keys(accountsData).length;

        return NextResponse.json({
            valid: true,
            license: bestLicense,
            maxAccounts: Number(bestLicense.maxAccounts || 1),
            connectedAccounts,
        });
    } catch (error) {
        console.error("[trading/access/validate POST]", error);
        return NextResponse.json(
            { valid: false, error: "Gateway validation failed." },
            { status: 500 }
        );
    }
}
