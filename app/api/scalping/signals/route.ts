import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { validateSymbol } from "@/lib/market-data/validation";
import type { SupportedSymbol } from "@/lib/market-data/types";
import { loadSignalConfig, scanSymbol } from "@/lib/ai-signals/engine";
import { passesQualityFilter } from "@/lib/ai-signals/quality-filter";
import { RADAR_SYMBOLS, RADAR_TIMEFRAME, toTerminalSignals, type SignalScanResult } from "@/lib/ai/scalping/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_SYMBOLS = 12;

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/scalping/signals?symbols=XAUUSD,EURUSD
 *
 * Live trade intelligence. This route does **not** generate signals — it calls
 * the existing deterministic scanner `scanSymbol` in `lib/ai-signals/engine.ts`
 * and re-projects whatever it returns. The scanner already enforces a minimum
 * confidence and a 2.0 minimum R:R, so a symbol with no qualifying setup simply
 * produces no signal and is reported in `rejected`.
 *
 * Nothing is fabricated: if the scanner returns nothing, the response contains
 * an empty `signals` array plus the reason per symbol.
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }

        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json(
                {
                    error: "Live trade intelligence requires an active trading license or a pro subscription.",
                    access,
                },
                { status: 403, headers: corsHeaders }
            );
        }

        const params = request.nextUrl.searchParams;
        const requested = (params.get("symbols") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

        const candidates: SupportedSymbol[] = [];
        const invalid: string[] = [];
        for (const s of (requested.length > 0 ? requested : RADAR_SYMBOLS).slice(0, MAX_SYMBOLS)) {
            const v = validateSymbol(s);
            if (v) candidates.push(v);
            else invalid.push(s);
        }

        if (candidates.length === 0) {
            return NextResponse.json(
                { error: "No supported symbols were requested.", invalid },
                { status: 400, headers: corsHeaders }
            );
        }

        const config = await loadSignalConfig();
        // Scan on the scalping entry timeframe only, so the terminal does not
        // multiply work across the config's full timeframe list.
        const timeframes = [RADAR_TIMEFRAME];

        const signals: SignalScanResult["signals"] = [];
        const rejected: SignalScanResult["rejected"] = [];

        for (const symbol of candidates) {
            try {
                const raw = await scanSymbol(symbol, config, timeframes);

                if (!raw || raw.length === 0) {
                    rejected.push({
                        symbol,
                        reason: `No setup met the configured gates (min confidence ${config.minimumConfidence}, min R:R ${config.minimumRiskReward}).`,
                    });
                    continue;
                }

                // Run the existing quality filter over the scanner output rather
                // than re-implementing the rules here.
                // passesQualityFilter already merges its own defaults, so the
                // live config is passed straight through.
                const accepted = raw.filter(
                    (s) => passesQualityFilter(s, config, []).passed
                );

                if (accepted.length === 0) {
                    rejected.push({
                        symbol,
                        reason: `${raw.length} raw setup(s) produced, all rejected by the signal quality filter.`,
                    });
                    continue;
                }

                signals.push(...toTerminalSignals(symbol, accepted));
            } catch (err) {
                rejected.push({
                    symbol,
                    reason: err instanceof Error ? err.message : "Signal scan failed.",
                });
            }
        }

        return NextResponse.json(
            {
                signals,
                rejected,
                invalid,
                asOf: Date.now(),
                engine: {
                    mode: "deterministic",
                    scanner: "lib/ai-signals/engine.ts#scanSymbol",
                    configVersion: config.id,
                    minConfidence: config.minimumConfidence,
                    minRiskReward: config.minimumRiskReward,
                },
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[scalping/signals]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Signal scan failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
