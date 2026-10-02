import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { gatherMultiSourceIntelligence } from "@/lib/market-intelligence/ai/external-intelligence-service";
import { buildTradingViewResearchContext } from "@/lib/market-intelligence/research/tradingview-research";
import { getTradingViewStatusForUser } from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { logTradingViewAudit } from "@/lib/market-intelligence/providers/tradingview/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = new Set(["terminal", "scalping", "research", "summary"]);

/**
 * GET /api/integrations/tradingview/context?symbol=XAUUSD&timeframe=M5&mode=terminal
 *
 * Authenticated. Returns TradingView MCP external context for the CALLER's
 * own connection. Used by the AI Terminal (multi-source analysis), the Pro
 * Scalping Terminal (external context section) and the Chrome Extension
 * (intelligence panel). Fail-closed: when TradingView is disabled, not
 * connected or failing, sections report their state explicitly and AlgoVault
 * data remains untouched.
 *
 * mode:
 *  - terminal → technicals + news + economic calendar (AI Terminal sections)
 *  - scalping → technicals + economic events (fast contextual panel)
 *  - research → technicals + news + calendar + fundamentals (research context)
 *  - summary  → technicals only (compact status for UI chips)
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const symbol = (params.get("symbol") || "").trim().toUpperCase();
    const timeframe = (params.get("timeframe") || "H1").trim().toUpperCase();
    const mode = (params.get("mode") || "terminal").trim().toLowerCase();

    if (!/^[A-Z0-9:._-]{1,24}$/.test(symbol)) {
        return NextResponse.json({ success: false, error: "Invalid symbol." }, { status: 400 });
    }
    if (!/^[A-Z0-9]{1,6}$/.test(timeframe)) {
        return NextResponse.json({ success: false, error: "Invalid timeframe." }, { status: 400 });
    }
    if (!MODES.has(mode)) {
        return NextResponse.json({ success: false, error: "Invalid mode." }, { status: 400 });
    }

    try {
        const status = await getTradingViewStatusForUser(token.uid);
        const currency = symbol.endsWith("USD") ? "USD" : symbol.startsWith("EUR") ? "EUR" : symbol.startsWith("GBP") ? "GBP" : symbol.startsWith("JPY") ? "JPY" : undefined;

        if (mode === "summary") {
            const result = await gatherMultiSourceIntelligence({
                uid: token.uid,
                symbol,
                timeframe,
                includeTechnicals: true,
                includeNews: false,
                includeEconomicCalendar: false,
            });
            return NextResponse.json({
                success: true,
                mode,
                symbol,
                timeframe,
                status,
                technicals: result.tradingview.technicals,
                anyExternalEvidence: result.anyExternalEvidence,
                limitations: result.limitations,
            });
        }

        const result = await gatherMultiSourceIntelligence({
            uid: token.uid,
            symbol,
            timeframe,
            includeTechnicals: true,
            includeNews: mode === "terminal" || mode === "research",
            includeEconomicCalendar: mode !== "research",
            currency,
        });

        let researchSections = null;
        if (mode === "research") {
            const research = await buildTradingViewResearchContext(token.uid, symbol, {
                includeTechnicals: false, // already gathered above
                includeNews: false,
                includeEconomicCalendar: false,
                includeFundamentals: true,
            });
            researchSections = research.sections;
        }

        await logTradingViewAudit({
            uid: token.uid,
            action: "read.capability",
            capability: "context",
            detail: { mode, symbol, anyExternalEvidence: result.anyExternalEvidence },
        });

        return NextResponse.json({
            success: true,
            mode,
            symbol,
            timeframe,
            status,
            tradingview: result.tradingview,
            ...(researchSections ? { research: researchSections } : {}),
            anyExternalEvidence: result.anyExternalEvidence,
            aiEvidenceText: result.aiEvidenceText,
            limitations: result.limitations,
        });
    } catch (err) {
        console.error("[tradingview-mcp] context failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "External context unavailable." }, { status: 500 });
    }
}
