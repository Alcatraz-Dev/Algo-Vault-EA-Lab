import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { interpretToDraft, strategyFromDraft } from "@/lib/strategy-lab/interpret";
import { saveStrategy } from "@/lib/strategy-lab/storage";
import { SupportedSymbol } from "@/lib/market-data/types";
import { TimeframeHierarchy } from "@/lib/strategy-lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * Natural-language strategy builder: turns a plain-English description into a
 * structured StrategyDraft (rules + config only — never MQL5). The draft flows
 * through the standard pipeline: review/edit → save → backtest → validate → EA.
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
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as {
            prompt?: string;
            symbol?: SupportedSymbol;
            direction?: "long" | "short";
            hierarchy?: Partial<TimeframeHierarchy>;
            save?: boolean;
        };

        const prompt = String(body.prompt ?? "").trim();
        if (!prompt || prompt.length < 4) {
            return NextResponse.json({ error: "Describe your strategy (at least a few words)." }, { status: 400, headers: corsHeaders });
        }

        const opts = {
            symbol: (body.symbol ?? "XAUUSD") as SupportedSymbol,
            direction: body.direction,
            hierarchy: body.hierarchy,
        };

        const { draft, generatedBy, provider, model } = await interpretToDraft(prompt, opts);

        // Optional: persist the draft as a saved strategy so the standard
        // pipeline (backtest/optimize/validate/EA) can run on it immediately.
        let strategy = null;
        if (body.save === true) {
            strategy = strategyFromDraft(draft, opts);
            const id = await saveStrategy(uid, strategy);
            strategy.id = id;
        }

        return NextResponse.json(
            {
                success: true,
                prompt,
                draft,
                generatedBy,
                provider,
                model,
                strategy,
                message: strategy
                    ? "Draft saved as a strategy — review it in the editor, then backtest and validate before generating an EA."
                    : "Draft ready for review — save it in the editor, then backtest and validate before generating an EA.",
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/interpret POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to interpret strategy" }, { status: 500, headers: corsHeaders });
    }
}