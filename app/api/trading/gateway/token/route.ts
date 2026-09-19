import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
    getGatewayTokenForUser,
    mintGatewayToken,
    revokeGatewayToken,
    hasActiveTradingLicense,
} from "@/lib/gateway";

export const runtime = "nodejs";

// ─── GET /api/trading/gateway/token ─────────────────────────────────────────
// Returns the authenticated user's current gateway token (if any).

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized." },
            { status: 401 }
        );
    }

    try {
        const currentToken = await getGatewayTokenForUser(token.uid);
        return NextResponse.json({ token: currentToken });
    } catch (error) {
        console.error("[trading/gateway/token GET]", error);
        return NextResponse.json(
            { error: "Failed to load gateway token." },
            { status: 500 }
        );
    }
}

// ─── POST /api/trading/gateway/token ────────────────────────────────────────
// Mints (or reuses) a gateway token for the authenticated user.
// Requires an active trading access license.

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized." },
            { status: 401 }
        );
    }

    try {
        const activeLicense = await hasActiveTradingLicense(token.uid);
        if (!activeLicense) {
            return NextResponse.json(
                { error: "An active Trading Access license is required to mint a gateway token." },
                { status: 403 }
            );
        }

        const { token: gatewayToken, reused } = await mintGatewayToken(token.uid, token.email ?? undefined);
        return NextResponse.json({ token: gatewayToken, reused });
    } catch (error) {
        console.error("[trading/gateway/token POST]", error);
        return NextResponse.json(
            { error: "Failed to mint gateway token." },
            { status: 500 }
        );
    }
}

// ─── DELETE /api/trading/gateway/token ──────────────────────────────────────
// Revokes the authenticated user's gateway token.

export async function DELETE(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized." },
            { status: 401 }
        );
    }

    try {
        const revoked = await revokeGatewayToken(token.uid);
        return NextResponse.json({ revoked });
    } catch (error) {
        console.error("[trading/gateway/token DELETE]", error);
        return NextResponse.json(
            { error: "Failed to revoke gateway token." },
            { status: 500 }
        );
    }
}