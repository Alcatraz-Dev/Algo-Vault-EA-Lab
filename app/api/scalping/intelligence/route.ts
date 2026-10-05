import { NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isUnifiedIntelligenceEnabled, signalMarketContext, orchestrateDecision, intelligenceFlagSnapshot, INTELLIGENCE_VERSION } from "@/lib/intelligence";
import { isProUser } from "@/lib/ai-signals/access";
import type { MarketContextInput } from "@/lib/intelligence/market-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BUY/SELL only when structure and higher-timeframe bias agree; anything
 * else (missing, neutral, conflicting) proposes HOLD.
 */
function proposedDirectionFrom(ctx: { structure?: { bias?: string } | null; htf?: { bias?: string } | null }): "BUY" | "SELL" | "HOLD" {
    const structure = ctx.structure?.bias?.toLowerCase();
    const htf = ctx.htf?.bias?.toLowerCase();
    if (structure === "bullish" && htf !== "bearish") return "BUY";
    if (structure === "bearish" && htf !== "bullish") return "SELL";
    return "HOLD";
}

// ── Decision cache ───────────────────────────────────────────────────────────
// Every orchestration spends scarce free-tier AI quota (Gemini ≈20/day,
// OpenRouter ≈50/day) while the terminal polls continuously. Decisions are
// therefore reused per symbol+timeframe for a short TTL; a failed (AI-
// unavailable) decision is cached for much less so recovery shows up fast.
const DECISION_CACHE = new Map<string, { at: number; payload: unknown; ttlMs: number }>();
const DECISION_CACHE_MAX = 200;

function decisionTtlMs(): number {
    const raw = Number(process.env.AI_SCALPING_DECISION_TTL_MS || "");
    return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
}

function cachedDecision(key: string): { at: number; payload: unknown } | null {
    const hit = DECISION_CACHE.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > hit.ttlMs) {
        DECISION_CACHE.delete(key);
        return null;
    }
    return { at: hit.at, payload: hit.payload };
}

function storeDecision(key: string, payload: unknown, ttlMs: number): void {
    if (DECISION_CACHE.size >= DECISION_CACHE_MAX) {
        // Drop the oldest entry — the map is tiny and insertion-ordered.
        const oldest = DECISION_CACHE.keys().next().value;
        if (oldest !== undefined) DECISION_CACHE.delete(oldest);
    }
    DECISION_CACHE.set(key, { at: Date.now(), payload, ttlMs });
}

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

        // Serve a recent decision without spending AI quota again.
        const cacheKey = `${symbol}:${timeframe}`;
        const hit = cachedDecision(cacheKey);
        if (hit) {
            return NextResponse.json({ ...(hit.payload as Record<string, unknown>), cachedAt: hit.at });
        }

        const decision = await orchestrateDecision({
            ctx,
            // Deterministic proposal from the SAME facts the panel displays
            // (structure + HTF bias). Jev validates it and may veto it to
            // HOLD; the risk engine below still gates everything. A flat or
            // conflicting context proposes HOLD — nothing is invented.
            proposedDirection: proposedDirectionFrom(ctx),
            userId: uid,
            userTier: "pro",
            skipLLM: false,
        });

        const body = {
            success: true as const,
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
        };

        const ttl = decision.validationStatus === "AI_UNAVAILABLE" ? 30_000 : decisionTtlMs();
        storeDecision(cacheKey, body, ttl);

        return NextResponse.json({ ...body, cachedAt: Date.now() });
    } catch (err) {
        console.error("[api/scalping/intelligence] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
