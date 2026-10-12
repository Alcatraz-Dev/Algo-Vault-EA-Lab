import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import { LIMITS } from "@/lib/ai/strategy-lab/evolution";
import { campaignStore } from "@/lib/ai/strategy-lab/campaign-storage";
import { buildCampaignDraft, type CampaignSpec } from "@/lib/ai/strategy-lab/campaign";
import { DEFAULT_HIERARCHY, PERIOD_DAYS, type AnalysisPeriod, type TimeframeHierarchy } from "@/lib/strategy-lab/types";
import type { SupportedSymbol } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * GET /api/strategy-lab/campaigns?limit=10&status=running
 *
 * Lists the caller's breeding campaigns, newest first. Campaign records are
 * summarised on the wire — the newest generation of each keeps its candidate
 * detail while older generations are stripped (same bounded-payload contract
 * as evolution runs).
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const params = request.nextUrl.searchParams;
        const campaignId = params.get("campaignId");
        const status = params.get("status");
        const limit = Number.parseInt(params.get("limit") ?? "10", 10);

        if (campaignId) {
            const campaign = await campaignStore.get(token.uid, campaignId);
            if (!campaign) {
                return NextResponse.json({ error: "Campaign not found." }, { status: 404, headers: corsHeaders });
            }
            return NextResponse.json({ campaign }, { status: 200, headers: corsHeaders });
        }

        const campaigns = await campaignStore.list(token.uid, {
            limit: Number.isFinite(limit) ? limit : 10,
            ...(status && (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "cancelled" || status === "cancel_requested")
                ? { status }
                : {}),
        });

        return NextResponse.json({ campaigns, count: campaigns.length }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/campaigns GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load campaigns" },
            { status: 500, headers: corsHeaders }
        );
    }
}

/**
 * POST /api/strategy-lab/campaigns
 *
 * Body: { symbol?, timeframe?, period?, generations?, seedPopulation? }
 *
 * Creates a durable breeding campaign. The campaign record freezes its data
 * window and seed at creation; work is performed by the `advance` endpoint in
 * generation-sized chunks. Returns an explicit `unavailable` reason (with real
 * coverage) instead of a campaign when the data bundle is insufficient.
 */
export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const rawSymbol = typeof body.symbol === "string" ? body.symbol : "XAUUSD";
        const symbol = validateSymbol(rawSymbol);
        if (!symbol) {
            return NextResponse.json({ error: `Unsupported symbol: ${rawSymbol}.` }, { status: 400, headers: corsHeaders });
        }

        const timeframe = validateTimeframe(typeof body.timeframe === "string" ? body.timeframe : "M15");
        if (!timeframe) {
            return NextResponse.json(
                { error: `Unsupported timeframe: ${String(body.timeframe)}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        const period = (typeof body.period === "string" ? body.period : "3M") as AnalysisPeriod;
        if (!PERIOD_DAYS[period]) {
            return NextResponse.json({ error: `Unsupported period: ${period}.` }, { status: 400, headers: corsHeaders });
        }

        const requestedGenerations = Number.parseInt(String(body.generations ?? "4"), 10);
        const generations = Number.isFinite(requestedGenerations)
            ? Math.max(1, Math.min(requestedGenerations, LIMITS.maxGenerations))
            : 4;

        const requestedSeed = Number.parseInt(String(body.seedPopulation ?? "12"), 10);
        const seedPopulation = Number.isFinite(requestedSeed)
            ? Math.max(2, Math.min(requestedSeed, LIMITS.maxSeeds))
            : 12;

        const hierarchy: TimeframeHierarchy = {
            ...DEFAULT_HIERARCHY,
            setup: timeframe,
            entry: timeframe,
            structure: timeframe === "H4" ? "H1" : "H1",
            macro: timeframe === "H1" ? "H4" : "H4",
        };

        const to = Date.now();
        const from = to - PERIOD_DAYS[period] * 86_400_000;

        const bundle = await loadDataBundle(symbol as SupportedSymbol, period, hierarchy);

        const hasAnyData = Object.values(bundle.candles).some((c) => Array.isArray(c) && c.length > 0);
        if (!hasAnyData) {
            return NextResponse.json(
                {
                    error: "No historical data available from the market data feed. Try again shortly or seed a local export.",
                    coverage: bundle.coverage,
                    requestedFrom: from,
                    requestedTo: to,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        const spec: CampaignSpec = {
            symbol: symbol as SupportedSymbol,
            timeframe,
            period,
            hierarchy,
            from,
            to,
            generations,
            seedPopulation,
            seed: `${uid}:${symbol}:${timeframe}:${period}`,
        };

        const draft = buildCampaignDraft({
            id: newId("camp"),
            uid,
            spec,
            bundle,
        });

        if (!draft.campaign) {
            return NextResponse.json(
                {
                    unavailable: draft.unavailable,
                    coverage: bundle.coverage,
                    error: draft.unavailable,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        await campaignStore.create(draft.campaign);

        return NextResponse.json(
            { campaign: draft.campaign, coverage: bundle.coverage },
            { status: 201, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/campaigns POST]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Campaign creation failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}