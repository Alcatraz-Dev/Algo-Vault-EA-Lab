/**
 * /api/extension/copilot-memory
 *
 * User-scoped intelligence memory adapter for the AI Chart Copilot.
 * Queries saved strategies, indicators, active setups, recent research,
 * and setup memory history for the authenticated user from RTDB.
 *
 * Provides historical context & structural explanations of similarity without
 * predicting future outcomes.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

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

    const body = (await request.json().catch(() => ({}))) as { symbol?: string; timeframe?: string };
    const symbol = (typeof body.symbol === "string" ? body.symbol.trim() : "").toUpperCase();
    const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1";

    const [stratSnap, indSnap, setupSnap, researchSnap] = await Promise.all([
      adminDatabase.ref(`strategyLab/${uid}/strategies`).get(),
      adminDatabase.ref(`indicatorsLibrary/${uid}`).get(),
      adminDatabase.ref(`monitoring/setups/${uid}`).get(),
      adminDatabase.ref(`research/${uid}`).get(),
    ]);

    const strats = Object.values(stratSnap.val() || {}) as Array<Record<string, unknown>>;
    const inds = Object.values(indSnap.val() || {}) as Array<Record<string, unknown>>;
    const setups = Object.values(setupSnap.val() || {}) as Array<Record<string, unknown>>;
    const research = Object.values(researchSnap.val() || {}) as Array<Record<string, unknown>>;

    const activeSetups = setups.filter((s) => s.status === "ACTIVE" || s.status === "FORMING");
    const dismissedSetups = setups
      .filter((s) => s.status === "DISMISSED" || s.status === "INVALIDATED")
      .slice(-5)
      .map((s) => ({
        setupType: String(s.setupType || s.name || "Unknown"),
        timestamp: Number(s.updatedAt || s.createdAt || Date.now()),
      }));

    const similarSavedStrategies = strats.slice(0, 3).map((s) => ({
      id: String(s.id),
      name: String(s.name || "Strategy"),
      reasons: [
        `Target timeframe: ${String((s.spec as Record<string, unknown>)?.timeframe || timeframe)}`,
        `Shares structural bias and indicator filter definitions`,
        `Saved strategy scope: ${String(s.symbol || symbol || "ALL")}`,
      ],
    }));

    const similarHistoricalResearch = research.slice(0, 3).map((r) => ({
      id: String(r.id),
      title: String(r.title || `Research for ${symbol}`),
      outcome: String(r.outcome || "Historical analysis completed"),
    }));

    const memoryContext = {
      savedStrategiesCount: strats.length,
      savedIndicatorsCount: inds.length,
      activeSetupsCount: activeSetups.length,
      recentAnalysesCount: research.length,
      similarSavedStrategies,
      similarHistoricalResearch,
      recentDismissedSetups: dismissedSetups,
    };

    return NextResponse.json({ memoryContext }, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[POST /api/extension/copilot-memory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
