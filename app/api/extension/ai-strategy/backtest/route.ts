/**
 * /api/extension/ai-strategy/backtest
 *
 * Handoff from the AI Strategy Generator to the existing AlgoVault
 * backtester. The endpoint runs the existing deterministic backtest
 * engine against the saved strategy and returns both the new
 * `backtestId` and the backtest URL on the website.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { getStrategy, saveBacktest } from "@/lib/strategy-lab/storage";
import { defaultBacktestConfig } from "@/lib/strategy-lab/backtest";

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
        const strategyId = typeof body.id === "string" ? body.id : "";
        const symbol = (typeof body.symbol === "string" ? body.symbol.trim() : "").toUpperCase();
        const timeframe = (typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1");

        if (!strategyId) {
            return NextResponse.json({ error: "id_required" }, { status: 400, headers: corsHeaders });
        }
        if (!symbol) {
            return NextResponse.json({ error: "symbol_required" }, { status: 400, headers: corsHeaders });
        }

        const strategy = await getStrategy(uid, strategyId);
        if (!strategy) {
            return NextResponse.json({ error: "strategy_not_found" }, { status: 404, headers: corsHeaders });
        }

        // Hand off to the AlgoVault backtester endpoint.
        const siteUrl = getAlgoVaultUrl();
        const backtestResp = await fetch(`${siteUrl}/api/strategy-lab/backtest`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                symbol,
                strategyId,
                timeframe,
                config: defaultBacktestConfig(),
            }),
        });

        let backtestId: string | null = null;
        if (backtestResp.ok) {
            try {
                const data = (await backtestResp.json()) as { backtest?: { id?: string }; success?: boolean };
                backtestId = data?.backtest?.id || null;
                if (backtestId) {
                    // Tag the strategy with the latest backtest id so it shows up in the workspace.
                    await adminDatabase.ref(`strategyLab/${uid}/strategies/${strategyId}/latestBacktestId`).set(backtestId);
                }
            } catch { /* ignore */ }
        } else {
            console.warn("[POST /api/extension/ai-strategy/backtest] handoff", backtestResp.status);
        }

        const params = new URLSearchParams();
        params.set("symbol", symbol);
        if (strategyId) params.set("strategyId", strategyId);
        if (backtestId) params.set("backtestId", backtestId);
        const url = `${siteUrl}/backtests?${params.toString()}`;

        return NextResponse.json({ backtestId, url }, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/ai-strategy/backtest]", err);
        return NextResponse.json(
            { backtestId: null, url: "", error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}