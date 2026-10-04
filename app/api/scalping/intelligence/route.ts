import { NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isUnifiedIntelligenceEnabled, signalMarketContext, orchestrateDecision, intelligenceFlagSnapshot, INTELLIGENCE_VERSION } from "@/lib/intelligence";
import { isProUser } from "@/lib/ai-signals/access";
import type { MarketContextInput } from "@/lib/intelligence/market-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scalping/intelligence?symbol=XAUUSD&timeframe=M5
 * Unified Intelligence Fabric decision state for the Pro Scalping Terminal.
 *
 * Builds the compressed market context server-side (the terminal never sends
 * market data), orchestrates deterministic facts → Jev → LLM, and returns the
 * decision state + concise Why? factors. Pro-gated.
 */
export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid || !isUnifiedIntelligenceEnabled()) {
            return NextResponse.json({ success: false, error: "UNAVAILABLE" }, { status: 404 });
        }
        if (!(await isProUser(uid))) {
            return NextResponse.json({ success: false, error: "PRO_REQUIRED" }, { status: 403 });
        }

        const url = new URL(req.url);
        const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
        const timeframe = url.searchParams.get("timeframe") || "M5";
        if (!symbol) {
            return NextResponse.json({ success: false, error: "INVALID_REQUEST", message: "symbol is required." }, { status: 400 });
        }

        // Reuse the terminal's own upstream snapshot source (same deterministic
        // pipeline the radar/analysis endpoints use) — no new data plumbing.
        const origin = new URL(req.url).origin;
        let snapshotPayload: Record<string, unknown> | null = null;
        try {
            const analysisRes = await fetch(`${origin}/api/analysis/intelligence?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10_000),
            });
            if (analysisRes.ok) {
                const body = (await analysisRes.json()) as { analysis?: Record<string, unknown> };
                snapshotPayload = body.analysis ?? null;
            }
        } catch {
            snapshotPayload = null;
        }

        // Compress whatever deterministic facts are available. When the
        // upstream analysis is unavailable the context carries only
        // symbol/timeframe — the orchestrator then reports honest degraded
        // states instead of inventing values.
        const snap = (snapshotPayload ?? {}) as Record<string, unknown>;
        const ctxInput: MarketContextInput = {
            symbol,
            timeframe,
            timestamp: typeof snap.timestamp === "number" ? snap.timestamp : Date.now(),
            currentPrice: typeof snap.currentPrice === "number" ? snap.currentPrice : typeof snap.price === "number" ? snap.price : undefined,
            trend: typeof snap.trend === "string" ? snap.trend : undefined,
            regime: typeof snap.regime === "string" ? snap.regime : undefined,
            marketStructure: typeof snap.marketStructure === "string" ? snap.marketStructure : undefined,
            volatility: (snap.volatility as MarketContextInput["volatility"]) ?? undefined,
            marketSession: typeof snap.marketSession === "string" ? snap.marketSession : undefined,
        };
        const ctx = signalMarketContext(
            {
                ...ctxInput,
                symbol,
                timeframe,
                timestamp: ctxInput.timestamp ?? Date.now(),
            } as unknown as Parameters<typeof signalMarketContext>[0],
            undefined,
        );

        const decision = await orchestrateDecision({
            ctx,
            proposedDirection: "HOLD",
            userId: uid,
            userTier: "pro",
            skipLLM: false,
        });

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            decision: {
                state: decision.state,
                direction: decision.direction,
                confidence: decision.confidence,
                rationale: decision.rationale,
                factors: decision.factors.slice(0, 12),
                jev: decision.jev
                    ? { decision: decision.jev.decision, confidence: decision.jev.confidence, status: decision.jev.validationStatus }
                    : null,
                llm: decision.llm
                    ? { provider: decision.llm.provider, model: decision.llm.model, summary: decision.llm.summary, confidence: decision.llm.confidence }
                    : null,
                validationStatus: decision.validationStatus,
            },
            versions: INTELLIGENCE_VERSION,
            flags: intelligenceFlagSnapshot(),
        });
    } catch (err) {
        console.error("[api/scalping/intelligence] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
