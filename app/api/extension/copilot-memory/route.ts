/**
 * /api/extension/copilot-memory
 *
 * User-scoped intelligence memory adapter for the AI Chart Copilot.
 * Reads saved strategies, indicators, active setups and research for the
 * authenticated user from RTDB.
 *
 * HONESTY CONTRACT (Phase 8 §7 / §24): this route reports only what it can
 * read and compare. It does NOT return historical outcome statistics, because
 * no similarity/outcome engine exists yet. Matches are exact symbol/timeframe
 * comparisons only, and the response declares that limit via
 * `similarityBasis` / `historicalStatisticsAvailable` / `historicalSampleSize`
 * so the copilot cannot present a near-match as a validated precedent.
 *
 * Previously this route returned the first 3 strategies in RTDB key order
 * alongside a hardcoded "Shares structural bias and indicator filter
 * definitions" claim and a default "Historical analysis completed" research
 * outcome. Both were fabricated and were fed into the copilot prompt.
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

    // Statuses below are the real `SetupMemoryRecord["status"]` union
    // (lib/market-intelligence/memory/types.ts). The previous version filtered
    // on "FORMING" and "DISMISSED", which exist in no enum, so those branches
    // never matched anything.
    const ACTIVE_STATUSES = new Set(["ACTIVE", "TRIGGERED", "PARTIALLY_MATCHED"]);
    const RESOLVED_STATUSES = new Set(["INVALIDATED", "CANCELLED", "EXPIRED"]);

    const activeSetups = setups.filter((s) => ACTIVE_STATUSES.has(String(s.status)));
    const dismissedSetups = setups
      .filter((s) => RESOLVED_STATUSES.has(String(s.status)))
      .slice(-5)
      .map((s) => ({
        setupType: String(s.setupType || s.name || "Unknown"),
        status: String(s.status),
        timestamp: Number(s.updatedAt || s.createdAt || Date.now()),
      }));

    // ── Honesty contract ──────────────────────────────────────────────────────
    // There is no historical-outcome similarity engine in the platform yet
    // (Phase 8 item 12 / "setup similarity" is still MISSING; the only
    // similarity that exists is exact structural-fingerprint dedup in
    // lib/strategy-research/fingerprint.ts, which yields no statistics).
    //
    // The previous implementation returned `strats.slice(0, 3)` — RTDB key
    // order, i.e. arbitrary — and asserted hardcoded reasons such as "Shares
    // structural bias and indicator filter definitions", plus a default
    // research outcome of "Historical analysis completed". That is fabricated
    // market context fed straight into the copilot prompt, which the Phase 8
    // brief explicitly forbids ("AI must not invent the event").
    //
    // We now match ONLY on fields we can actually read and compare, every
    // returned string is a verified fact about that record, and the response
    // declares its own limits so downstream prompts cannot over-claim.
    const matchingStrategies = strats
      .map((s) => {
        const spec = (s.spec as Record<string, unknown>) | undefined;
        const sSymbol = String(s.symbol || "").toUpperCase();
        const sTimeframe = String(spec?.timeframe || s.timeframe || "").toUpperCase();
        const reasons: string[] = [];
        if (sSymbol && sSymbol === symbol) reasons.push(`Saved on the same symbol: ${sSymbol}`);
        if (sTimeframe && sTimeframe === timeframe.toUpperCase()) {
          reasons.push(`Saved on the same timeframe: ${sTimeframe}`);
        }
        return { strategy: s, reasons, score: reasons.length };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((m) => ({
        id: String(m.strategy.id),
        name: String(m.strategy.name || "Strategy"),
        // Only verified, field-level matches. Never a structural claim.
        reasons: m.reasons,
      }));

    const researchForSymbol = research
      .filter((r) => {
        const rSymbol = String(r.symbol || "").toUpperCase();
        return rSymbol ? rSymbol === symbol : false;
      })
      .slice(0, 3)
      .map((r) => ({
        id: String(r.id),
        title: String(r.title || "Untitled research"),
        // Real stored outcome only. Empty string means "no recorded outcome" —
        // the copilot must treat that as unknown, not as a success.
        outcome: String(r.outcome || ""),
      }));

    const memoryContext = {
      savedStrategiesCount: strats.length,
      savedIndicatorsCount: inds.length,
      activeSetupsCount: activeSetups.length,
      recentAnalysesCount: research.length,
      // Same shape as before (chrome-extension CopilotView + copilot-engine
      // consume these names), but now empty unless a real match was verified.
      similarSavedStrategies: matchingStrategies,
      similarHistoricalResearch: researchForSymbol,
      recentDismissedSetups: dismissedSetups,
      /** Declared limits so no downstream prompt can imply real statistics. */
      similarityBasis: "symbol_timeframe_exact_match_only" as const,
      historicalStatisticsAvailable: false,
      historicalSampleSize: 0,
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
