/**
 * /api/extension/ai-strategy
 *
 * AI-driven strategy generation for the Pro extension.
 *
 * Pipeline:
 *   1. The model returns a JSON spec (entries, exits, filters, timeframe
 *      assumptions, risk assumptions) + Pine Script v5 strategy.
 *   2. The script is validated deterministically (braces/parens/eval).
 *   3. The strategy is stored under `strategyLab/{uid}/strategies` using
 *      the SAME shape as the existing Strategy Lab so it shows up in the
 *      user's library.
 *   5. The returned payload exposes a backtest URL that hands off to the
 *      existing AlgoVault backtester — no duplicate engine is created.
 *
 * Honest about deployment: the strategy is delivered to the user as a
 * Pine Script they can paste into TradingView. We do NOT claim auto-deploy
 * into TradingView.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { ai } from "@/lib/ai";
import { saveStrategy } from "@/lib/strategy-lab/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

const SYSTEM_PROMPT = `You are AlgoVault Strategy Engineer. Convert the trader's natural-language description into a Pine Script v5 STRATEGY (not indicator) for TradingView.

Return a single JSON object (no prose outside the JSON):
{
  "name": "Short name (max 60 chars)",
  "description": "Plain-English summary (max 400 chars)",
  "spec": {
    "symbolScope": "*",
    "timeframe": "H1",
    "entry": {"conditions": ["Plain text conditions"]},
    "exit": {
      "conditions": ["Plain text exit conditions"],
      "stopLogic": "Describe stop/invalidation logic",
      "takeProfitLogic": "Describe TP logic"
    },
    "filters": ["Filters applied before entry (e.g. session, spread, regime)"],
    "riskAssumptions": "Risk model assumptions (1-2 sentences)",
    "timeframeAssumptions": "Why this timeframe (1-2 sentences)"
  },
  "code": "//@version=5\\nstrategy(...)\\n...full Pine Script strategy...",
  "warnings": ["Disclaimers / limitations (each <= 120 chars)"]
}

Strategy rules:
- Always start with //@version=5
- Use strategy(...), not indicator(...).
- Use strategy.entry / strategy.exit / strategy.close for orders.
- Use strategy.position_size and strategy.equity for sizing context.
- Inputs use input.int / input.float / input.bool / input.string.
- Use only TA built-ins (ta.*, math.*, str.*, array.*).
- Default commission + slippage in strategy() declaration (e.g. commission_type=strategy.commission.cash_per_contract).
- Be explicit about stop/target in strategy.exit(...) — never leave them to chance.
- If the description is vague, choose the safest interpretation and add a warning.
`;

function validatePine(code: string): { syntaxOk: boolean; issues: string[] } {
    const issues: string[] = [];
    const versionMatch = code.match(/\/\/@version\s*=\s*(\d+)/);
    if (!versionMatch || Number(versionMatch[1]) !== 5) {
        issues.push("Missing or unsupported //@version directive (need v5).");
    }
    let depth = 0;
    for (const ch of code) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth < 0) { issues.push("Unbalanced braces."); break; }
    }
    if (depth !== 0) issues.push(`Unbalanced braces (depth=${depth}).`);
    let pDepth = 0;
    for (const ch of code) {
        if (ch === "(") pDepth++;
        else if (ch === ")") pDepth--;
        if (pDepth < 0) { issues.push("Unbalanced parentheses."); break; }
    }
    if (pDepth !== 0) issues.push(`Unbalanced parentheses (depth=${pDepth}).`);
    if (/\beval\s*\(/.test(code)) issues.push("Use of eval() is forbidden.");
    if (!/strategy\.(?:entry|exit|close)\b/.test(code)) {
        issues.push("Strategy code does not contain any strategy.entry / strategy.exit / strategy.close call.");
    }
    return { syntaxOk: issues.length === 0, issues };
}

function tryExtractJson(text: string): unknown | null {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (fence) {
            try {
                return JSON.parse(fence[1]);
            } catch { /* ignore */ }
        }
    }
    return null;
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

        const body = (await request.json().catch(() => ({}))) as { description?: string; symbolScope?: string; timeframe?: string };
        const description = typeof body.description === "string" ? body.description.trim() : "";
        if (!description) {
            return NextResponse.json({ error: "description_required" }, { status: 400, headers: corsHeaders });
        }
        const symbolScope = typeof body.symbolScope === "string" ? body.symbolScope.trim() : "*";
        const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1";

        const userPrompt = `Description: ${description}\nSymbol scope: ${symbolScope}\nTimeframe: ${timeframe}\nReturn ONLY the JSON spec described in the system prompt.`;

        const response = await ai.chat({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
            systemPrompt: SYSTEM_PROMPT,
            maxTokens: 3500,
            temperature: 0.3,
        }, { source: "plugin", userId: uid });

        const parsed = tryExtractJson(response.content);
        if (!parsed || typeof parsed !== "object") {
            return NextResponse.json(
                { error: "ai_parse_failed", message: "The model did not return a valid strategy spec." },
                { status: 502, headers: corsHeaders }
            );
        }
        const obj = parsed as Record<string, unknown>;
        const code = typeof obj.code === "string" ? obj.code : "";
        const validation = validatePine(code);

        const id = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const spec = (obj.spec && typeof obj.spec === "object" ? obj.spec : {}) as Record<string, unknown>;
        const record = {
            id,
            name: typeof obj.name === "string" ? obj.name : "AI Strategy",
            description: typeof obj.description === "string" ? obj.description : "",
            symbol: symbolScope,
            timeframe,
            status: "draft",
            spec: {
                symbolScope,
                timeframe,
                entry: spec.entry || { conditions: [] },
                exit: spec.exit || { conditions: [], stopLogic: "", takeProfitLogic: "" },
                filters: Array.isArray(spec.filters) ? (spec.filters as string[]) : [],
                riskAssumptions: typeof spec.riskAssumptions === "string" ? spec.riskAssumptions : "",
                timeframeAssumptions: typeof spec.timeframeAssumptions === "string" ? spec.timeframeAssumptions : "",
            },
            code,
            warnings: Array.isArray(obj.warnings) ? (obj.warnings as string[]) : validation.issues,
            validation: {
                syntaxOk: validation.syntaxOk,
                issues: validation.issues,
                savedToLibrary: false,
                strategyId: null as string | null,
            },
            createdAt: Date.now(),
            updated: Date.now(),
            source: "ai-strategy-generator",
        };

        // Save into the existing Strategy Lab storage (RTDB).
        try {
            const storedId = await saveStrategy(uid, record as never);
            record.validation.savedToLibrary = true;
            record.validation.strategyId = storedId;
        } catch (err) {
            console.warn("[POST /api/extension/ai-strategy] save failed", err);
        }

        return NextResponse.json({ strategy: record }, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/ai-strategy]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ strategies: [] }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    let decoded;
    try {
        decoded = await adminAuth.verifyIdToken(token);
    } catch {
        return NextResponse.json({ strategies: [] }, { status: 401, headers: corsHeaders });
    }
    const uid = decoded.uid;
    const snap = await adminDatabase.ref(`strategyLab/${uid}/strategies`).get();
    if (!snap.exists()) return NextResponse.json({ strategies: [] }, { status: 200, headers: corsHeaders });
    const list = Object.values(snap.val() || {}).filter((s) => (s as { source?: string }).source === "ai-strategy-generator") as Array<Record<string, unknown>>;
    return NextResponse.json(
        { strategies: list.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)) },
        { status: 200, headers: corsHeaders }
    );
}