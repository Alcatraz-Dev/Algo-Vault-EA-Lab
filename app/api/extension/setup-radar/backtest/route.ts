/**
 * /api/extension/setup-radar/backtest
 *
 * Triggers a backtest against the existing AlgoVault backtest engine
 * with the rules extracted from a Setup Radar card. Returns the URL
 * the extension can open so the user can review results.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

const getAlgoVaultUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "https://algovault.dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

async function isPro(uid: string): Promise<boolean> {
    try {
        const roleSnap = await adminDatabase.ref(`users/${uid}/role`).get();
        if (roleSnap.exists() && roleSnap.val() === "admin") return true;
        const subSnap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        if (!subSnap.exists()) return false;
        const sub = subSnap.val();
        const active = sub?.status === "active" || sub?.status === "trialing" || sub?.active === true;
        const eligible = !sub?.plan || ["pro", "elite", "enterprise", "vip"].includes(String(sub.plan).toLowerCase());
        return Boolean(active && eligible);
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        let decoded;
        try {
            decoded = await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: corsHeaders });
        }
        const uid = decoded.uid;
        if (!(await isPro(uid))) {
            return NextResponse.json({ error: "pro_required" }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as { id?: string; symbol?: string; timeframe?: string };
        const symbol = (typeof body.symbol === "string" ? body.symbol.trim() : "").toUpperCase();
        const timeframe = (typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1");

        if (!symbol) {
            return NextResponse.json({ error: "symbol_required" }, { status: 400, headers: corsHeaders });
        }

        const params = new URLSearchParams();
        params.set("symbol", symbol);
        if (timeframe) params.set("timeframe", timeframe);
        if (body.id) params.set("setupId", body.id);

        const siteUrl = getAlgoVaultUrl();
        const url = `${siteUrl}/backtests?${params.toString()}`;

        return NextResponse.json(
            { backtestId: null, url, note: "Backtesting is historical analysis. Past results do not guarantee future performance." },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        console.error("[POST /api/extension/setup-radar/backtest]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}