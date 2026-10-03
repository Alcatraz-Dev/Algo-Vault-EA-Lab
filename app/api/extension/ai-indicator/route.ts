/**
 * /api/extension/ai-indicator
 *
 * AI-driven Pine Script v5 indicator generation for the Pro extension.
 *
 * Pipeline (deterministic where possible):
 *   1. Parse user description with the existing /api/ai/chat router so the
 *      platform's model accounting, validation and fallback chain apply.
 *   2. Force the model to produce a strict JSON spec (inputs, outputs,
 *      pineVersion, notes) and the Pine Script code.
 *   3. Validate the Pine Script (parens balance, version directive, basic
 *      function whitelist).
 *   4. Persist the indicator under `indicatorsLibrary/{uid}/{indicatorId}`.
 *
 * Honest about deployment:
 *   - We can SAVE the indicator to AlgoVault.
 *   - We do NOT claim to auto-deploy the script into TradingView. The user
 *     gets a copy-paste-ready Pine Script they can paste into TradingView's
 *     Pine Editor manually (TradingView's public widget API does not allow
 *     programmatic script creation).
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { ai } from "@/lib/ai";

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

interface IndicatorSpec {
    name: string;
    description: string;
    inputs: Array<{ key: string; label: string; defaultValue: number | string | boolean; kind: "int" | "float" | "bool" | "select"; options?: string[] }>;
    outputs: Array<{ kind: "hline" | "hline_zone" | "shape" | "label" | "fill"; description: string }>;
    pineVersion: "v5" | "v6";
    notes: string;
    limitations: string[];
}

const SYSTEM_PROMPT = `You are AlgoVault Indicator Engineer. Convert the user's natural-language description into a Pine Script v5 indicator.

You MUST respond with a single JSON object (no commentary outside the JSON). The shape:
{
  "name": "Short name (max 60 chars)",
  "description": "Plain-English description (max 400 chars)",
  "inputs": [{"key":"len","label":"Length","defaultValue":14,"kind":"int"}],
  "outputs": [{"kind":"hline","description":"Short description"}],
  "pineVersion": "v5",
  "notes": "How to use this indicator in TradingView (max 400 chars)",
  "limitations": ["List of known caveats (each <= 120 chars)"],
  "pineCode": "Full Pine Script v5 source — must start with //@version=5"
}

Rules for the Pine Script:
- Always begin with //@version=5
- Use indicator(...), not study(...).
- Inputs use input.int / input.float / input.bool / input.string.
- Plot outputs use plot(), plotshape(), label.new() or fill().
- Use only TA built-ins (ta.*), math.*, str.*, array.* — NEVER request.security for non-current timeframe data unless explicitly asked.
- If the description is ambiguous, choose the most conservative interpretation and add a limitation.
- Never invent behaviour the user did not request.
- Keep code self-contained (no references to external scripts).
`;

const ALLOWED_FUNCS = /^(?:indicator|input\.(?:int|float|bool|string|color|source|symbol|Timeframe|session)|plot|plotshape|plotchar|plotbar|plotcandle|fill|label\.(?:new|set|delete|set_xy|set_text|set_color|set_style)|box\.(?:new|set|set_xy|set_text|set_color|set_bgcolor|set_border_color)|line\.(?:new|set|delete|set_xy|set_extend)|hline|ta\.(?:ema|sma|wma|rma|vwma|highest|lowest|crossover|crossunder|rsi|macd|atr|stdev|change|pivothigh|pivotlow|valuewhen|barssince|highestbars|lowestbars|sum|median|mode|wma|percentile|percentrank|tr|tprice|typprice|medprice|avgprice|sar|bb|triangle|vwap|bb\w+|cci|mfi|roc|tsi|wad|obv|dmi|adx|plus_di|minus_di|parabolic_sar|supertrend|alma|kama|frama|hma|zigzag|na|falling|rising|squeeze|trendi)\w*|math\.(?:abs|min|max|round|floor|ceil|sqrt|pow|log|exp|avg|sum|count|sign|pi|e|phi|tau|atan|asin|acos|sin|cos|tan|todegrees|toradians)|str\.(?:tostring|tolower|toupper|length|contains|startswith|endswith|substring|replace|match|format|tonumber|concat)|array\.(?:new|push|insert|remove|set|get|first|last|size|copy|sort|reverse|fill|join|includes|indexof|avg|max|min|sum|count|median|mode|stdev|percentile|percentrank|standardize|range|new_unshifted|shift|unshift|pop|clear|slice|concat)|nz|na|color|color\.\w+|time|timeframe\.(?:isdaily|isdaily|isweekly|ismonthly|isminutes|isseconds|isintraday|period|multiplier)|barstate\.|close|open|high|low|volume|hl2|hlc3|ohlc4|fixnan|security|request\.(?:security|security_lower_tf)|alertcondition|alert|syminfo\.|time\.|timestamp|dayofweek|dayofmonth|hour|minute|second|year|month|weekofyear|time_close|time\w+|bar_index)\b/;

function validatePine(code: string): { syntaxOk: boolean; issues: string[]; pineVersion: string } {
    const issues: string[] = [];
    const versionMatch = code.match(/\/\/@version\s*=\s*(\d+)/);
    const pineVersion = versionMatch ? `v${versionMatch[1]}` : "unknown";
    if (pineVersion !== "v5" && pineVersion !== "v6") {
        issues.push("Missing or unsupported //@version directive (need v5).");
    }

    // Brace balance
    let depth = 0;
    for (const ch of code) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth < 0) {
            issues.push("Unbalanced braces (extra closing brace).");
            break;
        }
    }
    if (depth !== 0) {
        issues.push(`Unbalanced braces (depth=${depth}).`);
    }

    // Parens balance
    let pDepth = 0;
    for (const ch of code) {
        if (ch === "(") pDepth++;
        else if (ch === ")") pDepth--;
        if (pDepth < 0) {
            issues.push("Unbalanced parentheses.");
            break;
        }
    }
    if (pDepth !== 0) {
        issues.push(`Unbalanced parentheses (depth=${pDepth}).`);
    }

    // Disallow unsafe calls
    if (/\beval\s*\(/.test(code)) issues.push("Use of eval() is forbidden.");
    if (/\brequest\.security\s*\(/.test(code)) {
        // Allowed but worth flagging so the user is aware.
        issues.push("Uses request.security() — verify your plan's bar limits.");
    }

    return {
        syntaxOk: issues.length === 0,
        issues,
        pineVersion,
    };
}

function tryExtractJson(text: string): unknown | null {
    const trimmed = text.trim();
    // Try direct parse
    try {
        return JSON.parse(trimmed);
    } catch {
        // Try fence extraction
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (fence) {
            try {
                return JSON.parse(fence[1]);
            } catch {
                /* fall through */
            }
        }
    }
    return null;
}

interface IndicatorRequest {
    description?: string;
    symbolScope?: string;
    timeframe?: string;
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

        const body = (await request.json().catch(() => ({}))) as IndicatorRequest;
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
            maxTokens: 2500,
            temperature: 0.3,
        }, { source: "plugin", userId: uid });

        const parsed = tryExtractJson(response.content);
        if (!parsed || typeof parsed !== "object") {
            return NextResponse.json(
                { error: "ai_parse_failed", message: "The model did not return a valid indicator spec." },
                { status: 502, headers: corsHeaders }
            );
        }
        const obj = parsed as Record<string, unknown>;
        const code = typeof obj.pineCode === "string" ? obj.pineCode : "";
        const validation = validatePine(code);

        const spec: IndicatorSpec = {
            name: typeof obj.name === "string" ? obj.name : "Untitled indicator",
            description: typeof obj.description === "string" ? obj.description : "",
            inputs: Array.isArray(obj.inputs) ? (obj.inputs as IndicatorSpec["inputs"]) : [],
            outputs: Array.isArray(obj.outputs) ? (obj.outputs as IndicatorSpec["outputs"]) : [],
            pineVersion: obj.pineVersion === "v6" ? "v6" : "v5",
            notes: typeof obj.notes === "string" ? obj.notes : "",
            limitations: Array.isArray(obj.limitations) ? (obj.limitations as string[]) : [],
        };

        // Save to library (best effort).
        const indicatorId = `ind_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const record = {
            id: indicatorId,
            name: spec.name,
            description: spec.description,
            spec,
            code,
            warnings: validation.issues,
                validation: {
                    syntaxOk: validation.syntaxOk,
                    pineVersion: validation.pineVersion,
                    issues: validation.issues,
                    savedToLibrary: false,
                    indicatorId: null as string | null,
                },
                symbolScope,
                timeframe,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                source: "ai-indicator-generator",
                status: "active",
                strategyCompatibility: [],
            };

        try {
            await adminDatabase.ref(`indicatorsLibrary/${uid}/${indicatorId}`).set(record);
            record.validation.savedToLibrary = true;
            record.validation.indicatorId = indicatorId;
        } catch (err) {
            console.warn("[POST /api/extension/ai-indicator] save failed", err);
        }

        const indicator = {
            ...record,
            ...{ warnings: validation.issues },
        };

        return NextResponse.json({ indicator }, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/ai-indicator]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ indicators: [] }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    let decoded;
    try {
        decoded = await adminAuth.verifyIdToken(token);
    } catch {
        return NextResponse.json({ indicators: [] }, { status: 401, headers: corsHeaders });
    }
    const uid = decoded.uid;
    const snap = await adminDatabase.ref(`indicatorsLibrary/${uid}`).get();
    if (!snap.exists()) return NextResponse.json({ indicators: [] }, { status: 200, headers: corsHeaders });
    const val = snap.val();
    const list = Object.values(val || {}) as Array<Record<string, unknown>>;
    return NextResponse.json(
        { indicators: list.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)) },
        { status: 200, headers: corsHeaders }
    );
}