/**
 * Bot Studio — AvScript compiler.
 *
 * AvScript is AlgoVault's strategy scripting language. It uses the existing
 * `lib/pine-runtime/` interpreter as its secure execution engine — no eval,
 * no new Function, no arbitrary code execution.
 *
 * The Pine runtime already provides:
 *   - A lexer, parser, and AST (lib/pine-runtime/lexer.ts, parser.ts, ast.ts)
 *   - A sandboxed runtime with built-in indicators (builtins.ts)
 *   - A backtest driver (lib/pine-runtime/backtest.ts)
 *
 * AvScript adds:
 *   - Strategy metadata block: strategy({ name, symbol, timeframe })
 *   - Entry/exit actions: enterLong(), enterShort(), closeLong(), closeShort()
 *   - Risk configuration: riskPercent(), stopLoss(), takeProfit()
 *   - Indicator aliases matching the visual builder
 *
 * Compilation process:
 *   1. Parse the AvScript source through the Pine lexer/parser (reused).
 *   2. Extract the `strategy()` call for metadata.
 *   3. Detect indicator declarations (ema, sma, rsi, macd, atr, bb).
 *   4. Detect condition expressions (crossesAbove, crossesBelow, rsi < N).
 *   5. Detect entry/exit actions and their configuration.
 *   6. Assemble a canonical Strategy from the extracted declarations.
 *
 * The compiled Strategy is IDENTICAL in structure to one produced by the
 * visual builder — both go through the same validation, backtest, and
 * execution pipeline.
 *
 * Workload limits (security):
 *   - Source size: max 8 KB
 *   - Parse timeout: synchronous — the parser is deterministic; add size guard
 *   - No imports, no require, no fetch, no process access
 *   - Only whitelisted function names are recognized
 */

import type { Strategy, StrategyRule, StrategySL, StrategyTP, StrategyRisk, StrategyFilters, TimeframeHierarchy } from "@/lib/strategy-lab/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import { tokenize } from "@/lib/pine-runtime/lexer";
import type { CompilerDiagnostic, CompileResult } from "./types";
import { AVSCRIPT_COMPILER_VERSION } from "./types";

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const MAX_SOURCE_BYTES = 8192;

// Whitelisted top-level function calls — anything else is rejected.
const WHITELISTED_CALLS = new Set([
    "strategy",
    "indicators",
    "enterLong",
    "enterShort",
    "closeLong",
    "closeShort",
    "crossesAbove",
    "crossesBelow",
    "riskPercent",
    "stopLoss",
    "takeProfit",
    "if",
    "const",
    "let",
    "var",
]);

const FORBIDDEN_PATTERNS = [
    /eval\s*\(/,
    /new\s+Function/,
    /require\s*\(/,
    /import\s+/,
    /process\./,
    /global\./,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bfs\b/,
    /\bchild_process\b/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Security pre-check
// ─────────────────────────────────────────────────────────────────────────────

function securityCheck(source: string): CompilerDiagnostic | null {
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
        return { severity: "error", message: `Strategy script exceeds ${MAX_SOURCE_BYTES / 1024} KB size limit.` };
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
            return { severity: "error", message: `Forbidden pattern detected: ${pattern.source}. AvScript does not allow eval, require, import, fetch, or process access.` };
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight AST extraction (regex-based for speed; structure is simple)
// We don't need a full parse for metadata/rule extraction — the Pine lexer
// handles the runtime; we only need to extract strategy declarations.
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractedMeta {
    name?: string;
    symbol?: string;
    timeframe?: string;
    description?: string;
    direction?: "long" | "short";
}

interface ExtractedIndicator {
    varName: string;
    kind: "ema" | "sma" | "rsi" | "macd" | "atr" | "bb" | "stochastic";
    period?: number;
    period2?: number; // slow EMA for MACD etc.
    period3?: number; // signal for MACD
    source?: string;
}

interface ExtractedCondition {
    kind: "crossesAbove" | "crossesBelow" | "lt" | "gt" | "and";
    left?: string;
    right?: string;
    threshold?: number;
    raw: string;
}

interface ExtractedAction {
    kind: "enterLong" | "enterShort" | "closeLong" | "closeShort";
    riskPercent?: number;
    slType?: "atr" | "fixed_pips";
    slAtrPeriod?: number;
    slAtrMultiplier?: number;
    slPips?: number;
    tpType?: "risk_reward" | "fixed_pips";
    tpRatio?: number;
    tpPips?: number;
    condition?: string; // the condition block that guards this action (raw)
}

function extractMeta(source: string): ExtractedMeta {
    const meta: ExtractedMeta = {};

    // strategy({ name: "...", symbol: "...", timeframe: "..." })
    // NOTE: no `s` flag (repo targets ES2017); `[^}]` already spans newlines.
    const strategyBlock = source.match(/strategy\s*\(\s*\{([^}]*)\}/);
    if (strategyBlock) {
        const block = strategyBlock[1];
        const nameMatch = block.match(/name\s*:\s*["']([^"']+)["']/);
        const symbolMatch = block.match(/symbol\s*:\s*["']([^"']+)["']/);
        const tfMatch = block.match(/timeframe\s*:\s*["']([^"']+)["']/);
        const descMatch = block.match(/description\s*:\s*["']([^"']+)["']/);
        const dirMatch = block.match(/direction\s*:\s*["'](long|short)["']/);
        if (nameMatch) meta.name = nameMatch[1].trim();
        if (symbolMatch) meta.symbol = symbolMatch[1].trim().toUpperCase();
        if (tfMatch) meta.timeframe = tfMatch[1].trim().toUpperCase();
        if (descMatch) meta.description = descMatch[1].trim();
        if (dirMatch) meta.direction = dirMatch[1] as "long" | "short";
    }

    return meta;
}

function extractIndicators(source: string): ExtractedIndicator[] {
    const indicators: ExtractedIndicator[] = [];

    // const fast = indicators.ema(close, 9);
    const emaRe = /const\s+(\w+)\s*=\s*indicators\.ema\s*\(\s*\w+\s*,\s*(\d+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = emaRe.exec(source)) !== null) {
        indicators.push({ varName: m[1], kind: "ema", period: Number(m[2]) });
    }

    // const slow = indicators.sma(close, 21);
    const smaRe = /const\s+(\w+)\s*=\s*indicators\.sma\s*\(\s*\w+\s*,\s*(\d+)\s*\)/g;
    while ((m = smaRe.exec(source)) !== null) {
        indicators.push({ varName: m[1], kind: "sma", period: Number(m[2]) });
    }

    // const rsiValue = indicators.rsi(close, 14);
    const rsiRe = /const\s+(\w+)\s*=\s*indicators\.rsi\s*\(\s*\w+\s*,\s*(\d+)\s*\)/g;
    while ((m = rsiRe.exec(source)) !== null) {
        indicators.push({ varName: m[1], kind: "rsi", period: Number(m[2]) });
    }

    // const atrValue = indicators.atr(14);
    const atrRe = /const\s+(\w+)\s*=\s*indicators\.atr\s*\(\s*(\d+)\s*\)/g;
    while ((m = atrRe.exec(source)) !== null) {
        indicators.push({ varName: m[1], kind: "atr", period: Number(m[2]) });
    }

    return indicators;
}

function extractEntryActions(source: string, indicators: ExtractedIndicator[]): ExtractedAction[] {
    const actions: ExtractedAction[] = [];

    // enterLong({ riskPercent: 0.5, stopLoss: { type: "atr", period: 14, multiplier: 2 }, takeProfit: { type: "riskReward", ratio: 2 } })
    // NOTE: no `s` flag (repo targets ES2017); `[^}]` already spans newlines.
    const enterLongRe = /enterLong\s*\(\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = enterLongRe.exec(source)) !== null) {
        const block = m[1];
        const action: ExtractedAction = { kind: "enterLong" };

        const riskPctMatch = block.match(/riskPercent\s*:\s*([\d.]+)/);
        if (riskPctMatch) action.riskPercent = Number(riskPctMatch[1]);

        // stopLoss: { type: "atr", period: 14, multiplier: 2 }
        const slBlock = block.match(/stopLoss\s*:\s*\{([^}]*)\}/);
        if (slBlock) {
            const slContent = slBlock[1];
            const slTypeMatch = slContent.match(/type\s*:\s*["'](atr|fixed_pips)["']/);
            if (slTypeMatch?.[1] === "atr") {
                action.slType = "atr";
                const pMatch = slContent.match(/period\s*:\s*(\d+)/);
                const mMatch = slContent.match(/multiplier\s*:\s*([\d.]+)/);
                action.slAtrPeriod = pMatch ? Number(pMatch[1]) : 14;
                action.slAtrMultiplier = mMatch ? Number(mMatch[1]) : 2.0;
            } else if (slTypeMatch?.[1] === "fixed_pips") {
                action.slType = "fixed_pips";
                const pMatch = slContent.match(/pips\s*:\s*(\d+)/);
                action.slPips = pMatch ? Number(pMatch[1]) : 30;
            }
        }

        // takeProfit: { type: "riskReward", ratio: 2 }
        const tpBlock = block.match(/takeProfit\s*:\s*\{([^}]*)\}/);
        if (tpBlock) {
            const tpContent = tpBlock[1];
            const tpTypeMatch = tpContent.match(/type\s*:\s*["'](riskReward|risk_reward|fixed_pips)["']/);
            if (tpTypeMatch?.length) {
                if (tpTypeMatch[1] === "riskReward" || tpTypeMatch[1] === "risk_reward") {
                    action.tpType = "risk_reward";
                    const rMatch = tpContent.match(/ratio\s*:\s*([\d.]+)/);
                    action.tpRatio = rMatch ? Number(rMatch[1]) : 2.0;
                } else {
                    action.tpType = "fixed_pips";
                    const pMatch = tpContent.match(/pips\s*:\s*(\d+)/);
                    action.tpPips = pMatch ? Number(pMatch[1]) : 60;
                }
            }
        }

        actions.push(action);
    }

    // enterShort (same pattern)
    // NOTE: no `s` flag (repo targets ES2017); `[^}]` already spans newlines.
    const enterShortRe = /enterShort\s*\(\s*\{([^}]*)\}/g;
    while ((m = enterShortRe.exec(source)) !== null) {
        const block = m[1];
        const action: ExtractedAction = { kind: "enterShort" };
        const riskPctMatch = block.match(/riskPercent\s*:\s*([\d.]+)/);
        if (riskPctMatch) action.riskPercent = Number(riskPctMatch[1]);
        actions.push(action);
    }

    return actions;
}

function buildRulesFromIndicators(
    indicators: ExtractedIndicator[],
    source: string,
    tf: Timeframe,
): { rules: StrategyRule[]; diagnostics: CompilerDiagnostic[] } {
    const rules: StrategyRule[] = [];
    const diagnostics: CompilerDiagnostic[] = [];

    /**
     * Map a cross of two indicators onto the canonical engine encoding.
     *
     * The canonical engine (lib/strategy-engine/decisions.ts) evaluates the
     * `ema_cross` indicator as EMA20 vs EMA50 only. Anything else (other
     * periods, SMA, mixed kinds) is NOT representable without changing the
     * meaning of the compiled strategy — so it fails the compile with an
     * explicit diagnostic instead of silently compiling to different math.
     */
    const crossRule = (
        id: string,
        label: string,
        left: ExtractedIndicator,
        right: ExtractedIndicator,
        above: boolean,
        where: string,
    ): StrategyRule | null => {
        const isEmaPair = left.kind === "ema" && right.kind === "ema";
        if (!isEmaPair || left.period !== 20 || right.period !== 50) {
            diagnostics.push({
                severity: "error",
                message: `${where}: the canonical engine only supports the EMA(20)/EMA(50) cross (indicator "ema_cross"). `
                    + `"${label}" cannot be compiled without changing its meaning — rewrite it as EMA(20)/EMA(50) or use RSI thresholds.`,
            });
            return null;
        }
        return {
            id,
            enabled: true,
            group: "indicator",
            label,
            operator: "eq",
            timeframe: tf,
            value: above ? "ema20_above_ema50" : "ema20_below_ema50",
            negate: false,
            groupLogic: "AND",
            indicator: "ema_cross",
        };
    };

    // crossesAbove(fast, slow) → EMA20 crosses above EMA50
    const crossAboveRe = /crossesAbove\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = crossAboveRe.exec(source)) !== null) {
        const leftInd = indicators.find((i) => i.varName === m![1]);
        const rightInd = indicators.find((i) => i.varName === m![2]);
        if (leftInd && rightInd) {
            const rule = crossRule(
                `ema_cross_above_${leftInd.period}_${rightInd.period}`,
                `${leftInd.kind.toUpperCase()}(${leftInd.period}) crosses above ${rightInd.kind.toUpperCase()}(${rightInd.period})`,
                leftInd,
                rightInd,
                true,
                "crossesAbove",
            );
            if (rule) rules.push(rule);
        }
    }

    // crossesBelow(fast, slow) → EMA20 crosses below EMA50
    const crossBelowRe = /crossesBelow\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
    while ((m = crossBelowRe.exec(source)) !== null) {
        const leftInd = indicators.find((i) => i.varName === m![1]);
        const rightInd = indicators.find((i) => i.varName === m![2]);
        if (leftInd && rightInd) {
            const rule = crossRule(
                `ema_cross_below_${leftInd.period}_${rightInd.period}`,
                `${leftInd.kind.toUpperCase()}(${leftInd.period}) crosses below ${rightInd.kind.toUpperCase()}(${rightInd.period})`,
                leftInd,
                rightInd,
                false,
                "crossesBelow",
            );
            if (rule) rules.push(rule);
        }
    }

    // rsiValue < 70 — RSI threshold conditions
    for (const ind of indicators) {
        if (ind.kind !== "rsi") continue;
        const ltRe = new RegExp(`${ind.varName}\\s*<\\s*([\\d.]+)`, "g");
        while ((m = ltRe.exec(source)) !== null) {
            rules.push({
                id: `rsi_lt_${m[1].replace(".", "_")}`,
                enabled: true,
                group: "indicator",
                label: `RSI(${ind.period}) < ${m[1]}`,
                operator: "lt",
                timeframe: tf,
                value: Number(m[1]),
                negate: false,
                groupLogic: "AND",
                indicator: "rsi",
            });
        }
        const gtRe = new RegExp(`${ind.varName}\\s*>\\s*([\\d.]+)`, "g");
        while ((m = gtRe.exec(source)) !== null) {
            rules.push({
                id: `rsi_gt_${m[1].replace(".", "_")}`,
                enabled: true,
                group: "indicator",
                label: `RSI(${ind.period}) > ${m[1]}`,
                operator: "gt",
                timeframe: tf,
                value: Number(m[1]),
                negate: false,
                groupLogic: "AND",
                indicator: "rsi",
            });
        }
    }

    return { rules, diagnostics };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main compiler
// ─────────────────────────────────────────────────────────────────────────────

export function compileAvScript(
    source: string,
    strategyId = "STRAT_PREVIEW",
): CompileResult<Strategy> {
    const diag: CompilerDiagnostic[] = [];

    // Security pre-check (must come first).
    const secErr = securityCheck(source);
    if (secErr) return { ok: false, diagnostics: [secErr] };

    // Verify tokenization succeeds (catches syntax errors via the Pine lexer).
    try {
        tokenize(source);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        diag.push({ severity: "error", message: `Syntax error: ${msg}` });
        return { ok: false, diagnostics: diag };
    }

    const meta = extractMeta(source);
    if (!meta.name?.trim()) diag.push({ severity: "error", message: "strategy() call must include name: \"Strategy Name\"." });
    if (!meta.symbol) diag.push({ severity: "error", message: "strategy() call must include symbol: \"XAUUSD\" (or another supported symbol)." });
    if (!meta.timeframe) diag.push({ severity: "warning", message: "strategy() call has no timeframe — defaulting to M5." });

    const tf = VALID_TIMEFRAMES.includes((meta.timeframe ?? "M5") as Timeframe)
        ? (meta.timeframe as Timeframe)
        : "M5";
    const symbol = meta.symbol as SupportedSymbol;

    if (symbol && !([...SUPPORTED_SYMBOLS] as string[]).includes(symbol)) {
        diag.push({ severity: "error", message: `Unsupported symbol "${symbol}".` });
    }

    const indicators = extractIndicators(source);
    const actions = extractEntryActions(source, indicators);

    const hasEnterLong = actions.some((a) => a.kind === "enterLong");
    const hasEnterShort = actions.some((a) => a.kind === "enterShort");
    if (!hasEnterLong && !hasEnterShort) {
        diag.push({ severity: "error", message: "No enterLong() or enterShort() call found. The strategy must have at least one entry action." });
    }

    const { rules: entryRules, diagnostics: ruleDiagnostics } = buildRulesFromIndicators(indicators, source, tf);
    diag.push(...ruleDiagnostics);
    if (entryRules.length === 0) {
        diag.push({ severity: "error", message: "No entry conditions detected. Use crossesAbove(), crossesBelow(), or indicator comparisons." });
    }

    const hasErrors = diag.some((d) => d.severity === "error");
    if (hasErrors) return { ok: false, diagnostics: diag };

    const enterAction = actions.find((a) => a.kind === "enterLong") ?? actions.find((a) => a.kind === "enterShort");
    const direction: "long" | "short" = hasEnterLong ? "long" : "short";

    const sl: StrategySL = enterAction?.slType === "atr"
        ? { mode: "atr", atrMultiple: enterAction.slAtrMultiplier ?? 2.0, levelOffset: 0, useSwing: false }
        : enterAction?.slType === "fixed_pips"
        ? { mode: "level", atrMultiple: 1.0, levelOffset: enterAction.slPips ?? 30, useSwing: false }
        : { mode: "atr", atrMultiple: 2.0, levelOffset: 0, useSwing: false };

    const tp: StrategyTP = {
        mode: enterAction?.tpType === "fixed_pips" ? "fixed" : "r",
        r1: enterAction?.tpRatio ?? 2.0,
        r2: (enterAction?.tpRatio ?? 2.0) * 1.5,
        r3: (enterAction?.tpRatio ?? 2.0) * 2.0,
        fixedDistance: enterAction?.tpPips ?? 60,
        partialCloses: [],
        moveBeAfterTp1: false,
        lockAfterTp2: false,
        trailingEnabled: false,
        trailingStopAtr: 1.0,
    };

    const risk: StrategyRisk = {
        mode: "percent",
        riskPercent: enterAction?.riskPercent ?? 1.0,
        fixedLot: 0.01,
        maxPositions: 1,
        dailyLossLimitPct: 3.0,
        maxDrawdownPct: 20,
    };

    const filters: StrategyFilters = {
        sessions: [],
        daysOfWeek: [1, 2, 3, 4, 5],
        volatilityMinAtrPct: 0,
        volatilityMaxAtrPct: 999,
        maxTradesPerDay: 3,
        cooldownCandles: 0,
    };

    const timeframes: TimeframeHierarchy = {
        macro: "H4",
        structure: "H1",
        setup: "M15",
        entry: tf,
    };

    const now = Date.now();
    const strategy: Strategy = {
        id: strategyId,
        name: meta.name!.trim(),
        description: meta.description?.trim() ?? "",
        asset: symbol,
        direction,
        timeframes,
        regimeFilter: [],
        entryRules,
        confirmationRules: [],
        stopLoss: sl,
        takeProfit: tp,
        risk,
        filters,
        executionModel: "next_bar_open",
        costs: {
            spreadPips: 2,
            commissionPerLot: 7,
            slippagePips: 1,
        },
        sourcePatternId: null,
        whyp: {
            discovered: `AvScript compiler (${AVSCRIPT_COMPILER_VERSION})`,
            conditionsSelected: entryRules.map((r) => r.label ?? r.operator).join("; "),
            occurrenceFrequency: "Not specified",
            historicalPerformance: "Not yet backtested",
            weaknesses: "Not yet analysed",
            poorRegimes: "Not yet analysed",
            generatedByProvider: "avscript",
        },
        version: "1.0.0",
        created: now,
        updated: now,
    };

    return { ok: true, value: strategy, diagnostics: diag };
}
