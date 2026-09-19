import { NextRequest, NextResponse } from "next/server";
import { ai, defaultRouter } from "@/lib/ai";

export const runtime = "nodejs";

type AlertPayloadFormat = "message" | "json";

type AlertContext = {
    symbol: string;
    timeframe: string;
    scriptName: string;
    signal: string;
    isStrategy: boolean;
    instruction: string;
};

const SYSTEM_PROMPT = `You write alert content for AlgoVault, a TradingView-style trading platform.

The user is filling a field called "Message Body / JSON Payload" on a price/strategy alert.
The content may contain TradingView placeholders, e.g. {{ticker}}, {{close}}, {{time}},
{{timeframe}}, {{volume}}, {{strategy.order.action}}, {{strategy.position_size}}.

Rules:
- If the requested format is "message": return ONE short human-readable sentence using placeholders. No quotes, no markdown, no explanation.
- If the requested format is "json": return ONLY a valid JSON object template (no markdown fences, no commentary). Keys should be descriptive. Numeric placeholders like {{close}} must be unquoted so they remain numbers after substitution; string placeholders stay quoted.
- Never wrap the output in code fences.
- Output only the message or the JSON object, nothing else.`;

function deriveExchange(symbol: string): string {
    const compact = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (compact.startsWith("XAU") || compact.startsWith("XAG")) return "METALS";
    if (["US30", "NAS100", "SPX500"].some((s) => compact.includes(s))) return "INDEX";
    if (compact.startsWith("BTC") || compact.startsWith("ETH")) return "CRYPTO";
    return "FX";
}

// Known field keywords the user may ask for in natural language, mapped to a
// JSON key and its placeholder/value. `numeric` fields stay unquoted so they
// remain numbers after TradingView substitutes the placeholder.
type FieldSpec = { key: string; raw: string; numeric?: boolean };

function fieldFor(token: string, ctx: AlertContext): FieldSpec | null {
    switch (token) {
        case "side":
        case "action":
        case "direction":
            return { key: "side", raw: JSON.stringify("{{strategy.order.action}}") };
        case "ticker":
        case "symbol":
            return { key: "ticker", raw: JSON.stringify("{{ticker}}") };
        case "price":
        case "close":
        case "entry":
            return { key: "price", raw: "{{close}}", numeric: true };
        case "time":
        case "timestamp":
        case "date":
            return { key: "time", raw: JSON.stringify("{{time}}") };
        case "timeframe":
        case "interval":
            return { key: "interval", raw: JSON.stringify("{{timeframe}}") };
        case "volume":
            return { key: "volume", raw: "{{volume}}", numeric: true };
        case "position":
        case "position_size":
        case "size":
        case "qty":
        case "quantity":
            return { key: "position_size", raw: JSON.stringify("{{strategy.position_size}}") };
        case "message":
        case "note":
            return { key: "message", raw: JSON.stringify(alertSentence(ctx)) };
        case "signal":
        case "alert":
            return { key: "signal", raw: JSON.stringify(ctx.signal || "alert") };
        case "script":
        case "strategy":
        case "indicator":
            return { key: "script", raw: JSON.stringify(ctx.scriptName || "Pine Script") };
        case "exchange":
        case "broker":
            return { key: "exchange", raw: JSON.stringify(deriveExchange(ctx.symbol)) };
        default:
            return null;
    }
}

function alertSentence(ctx: AlertContext): string {
    if (ctx.isStrategy) {
        return `{{strategy.order.action}} on {{ticker}} {{timeframe}} @ {{close}} ({{strategy.position_size}}) at {{time}}`;
    }
    return `"${ctx.signal || ctx.scriptName || "Alert"}" triggered on {{ticker}} ${ctx.timeframe} @ {{close}} at {{time}}`;
}

/**
 * Deterministic generator used when no cloud AI provider is configured. It
 * honours the user's instruction (e.g. "json with side, ticker, price") so the
 * output actually changes with the input instead of returning a fixed template.
 */
function buildTemplatePayload(ctx: AlertContext, format: AlertPayloadFormat): string {
    const tokens = ctx.instruction.toLowerCase().split(/[^a-z_]+/).filter(Boolean);
    const requested: FieldSpec[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
        const spec = fieldFor(token, ctx);
        if (spec && !seen.has(spec.key)) {
            seen.add(spec.key);
            requested.push(spec);
        }
    }

    if (format === "message") {
        return `Alert: "${ctx.scriptName || "Script"}" ${alertSentence(ctx)} (${ctx.symbol || "market"})`;
    }

    const fields: FieldSpec[] =
        requested.length > 0
            ? requested
            : ctx.isStrategy
                ? [
                    { key: "side", raw: JSON.stringify("{{strategy.order.action}}") },
                    { key: "ticker", raw: JSON.stringify("{{ticker}}") },
                    { key: "position_size", raw: JSON.stringify("{{strategy.position_size}}") },
                    { key: "price", raw: "{{close}}", numeric: true },
                    { key: "time", raw: JSON.stringify("{{time}}") },
                ]
                : [
                    { key: "ticker", raw: JSON.stringify("{{ticker}}") },
                    { key: "timeframe", raw: JSON.stringify("{{timeframe}}") },
                    { key: "signal", raw: JSON.stringify(ctx.signal || "alert") },
                    { key: "price", raw: "{{close}}", numeric: true },
                    { key: "time", raw: JSON.stringify("{{time}}") },
                ];

    return `{\n${fields.map((f) => `  "${f.key}": ${f.raw}`).join(",\n")}\n}`;
}

/**
 * Keep numeric TradingView placeholders unquoted even when the model quoted
 * them (e.g. `"price": "{{close}}"` -> `"price": {{close}}`). Safe: only
 * touches exact `"key": "{{numeric}}"` patterns.
 */
function unquoteNumericPlaceholders(content: string): string {
    return content.replace(/"([A-Za-z_]+)":\s*"(\{\{(?:close|open|high|low|volume)\}\})"/g, '"$1": $2');
}

/**
 * Template-aware JSON check. TradingView payloads intentionally leave numeric
 * placeholders unquoted (`"price": {{close}}`), which is not strict JSON. We
 * probe validity by swapping each `{{...}}` for `0` and parsing that. Only the
 * whole response being a JSON object counts, so bare placeholders (e.g. a
 * model that echoes `{{close}}`) are rejected.
 */
function isValidTemplateJson(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return false;
    }
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        const probe = trimmed.replace(/\{\{[^{}]*\}\}/g, "0");
        try {
            JSON.parse(probe);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Extract the first usable JSON object from model output: fenced block, whole
 * response, then the first balanced-brace block. Falls back to a light repair
 * (stray fences, unquoted keys, trailing commas) if strict/template parsing
 * fails. Returns null when nothing parses.
 */
function extractJsonBlock(content: string): string | null {
    const candidates: string[] = [];

    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) candidates.push(fenced[1].trim());
    candidates.push(content.trim());

    const start = content.indexOf("{");
    if (start !== -1) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < content.length; i++) {
            const ch = content[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === '"') inString = false;
            } else if (ch === '"') {
                inString = true;
            } else if (ch === "{") {
                depth++;
            } else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    candidates.push(content.slice(start, i + 1));
                    break;
                }
            }
        }
    }

    const seen = new Set<string>();
    for (const raw of candidates) {
        for (const variant of [raw, repairJson(raw)]) {
            if (!seen.has(variant)) {
                seen.add(variant);
                if (isValidTemplateJson(variant)) {
                    return variant;
                }
            }
        }
    }
    return null;
}

/**
 * Repair common free-model JSON mistakes: stray code fences, unquoted keys,
 * and trailing commas. Applied only after parsing falls through.
 */
function repairJson(content: string): string {
    return content
        .replace(/^\s*```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .replace(/(\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/,(\s*[}\]])/g, "$1");
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            symbol = "",
            timeframe = "",
            scriptName = "",
            signal = "",
            isStrategy = false,
            format = "message",
            instruction = "",
        } = body as Partial<AlertContext> & { format?: AlertPayloadFormat };

        const resolvedFormat: AlertPayloadFormat = format === "json" ? "json" : "message";
        const ctx: AlertContext = {
            symbol: String(symbol),
            timeframe: String(timeframe),
            scriptName: String(scriptName),
            signal: String(signal),
            isStrategy: Boolean(isStrategy),
            instruction: String(instruction || ""),
        };

        // Only call the AI gateway when a real cloud provider is configured.
        // Otherwise the gateway silently returns a local heuristic that just
        // echoes the prompt, which is worse than our own template.
        const availableProviders = await defaultRouter.getAvailableProviders();

        if (availableProviders.length > 0) {
            // The free router picks a different model per call, so retry once
            // instead of falling straight back to the template when the
            // first response is unusable.
            const maxTries = 2;

            for (let attempt = 0; attempt < maxTries; attempt++) {
                try {
                    const userPrompt = [
                        `Alert context:`,
                        `- Symbol: ${ctx.symbol || "unknown"}`,
                        `- Timeframe: ${ctx.timeframe || "unknown"}`,
                        `- Script: ${ctx.scriptName || "Pine Script"}`,
                        `- Trigger signal: ${ctx.signal || "any alert"}`,
                        `- Is strategy: ${ctx.isStrategy ? "yes" : "no"}`,
                        `- Requested format: ${resolvedFormat}`,
                        ctx.instruction ? `\nUser instruction: ${ctx.instruction.slice(0, 500)}` : "",
                        `\nReturn only the ${resolvedFormat === "json" ? "JSON object" : "message"}.`,
                    ]
                        .filter(Boolean)
                        .join("\n");

                    const response = await ai.chat({
                        messages: [{ role: "user", content: userPrompt }],
                        systemPrompt: SYSTEM_PROMPT,
                        temperature: 0.4,
                        maxTokens: 400,
                    });

                    let content = String(response.content || "")
                        .replace(/^```[a-zA-Z]*\n?/, "")
                        .replace(/```$/, "")
                        .trim();

                    const isHeuristic =
                        response.provider === "local-heuristic" ||
                        content.includes("local heuristic gateway") ||
                        content.startsWith("Alert context:");

                    if (!content || isHeuristic) {
                        continue;
                    }

                    if (resolvedFormat === "json") {
                        const block = extractJsonBlock(content);
                        if (!block) {
                            continue;
                        }
                        content = unquoteNumericPlaceholders(block);
                    }

                    return NextResponse.json({
                        success: true,
                        content,
                        source: "ai",
                        provider: response.provider,
                        model: response.model,
                    });
                } catch (aiErr) {
                    console.warn(`[ai-alert-payload] AI attempt ${attempt + 1}/${maxTries} failed:`, aiErr);
                }
            }
        }

        return NextResponse.json({
            success: true,
            content: buildTemplatePayload(ctx, resolvedFormat),
            source: "template",
        });
    } catch (err: unknown) {
        console.error("[ai-alert-payload]", err);
        return NextResponse.json(
            { success: false, message: err instanceof Error ? err.message : "Failed to generate payload." },
            { status: 500 }
        );
    }
}
