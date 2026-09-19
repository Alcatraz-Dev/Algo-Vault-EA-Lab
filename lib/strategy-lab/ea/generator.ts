// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — deterministic orchestrator.
//
// Pipeline (all deterministic — AI may only produce structured rules, never
// MQL5 text):
//
//   validate → AST → translate rules → build MQL5 → static check + real
//   MetaEditor compile (when available) → parity report
//
// Any rule that cannot be deterministically translated is reported loudly; the
// harness never silently alters a strategy to make it compile.
// ─────────────────────────────────────────────────────────────────────────────

import { Strategy } from "../types";
import { getSymbolSpec } from "../../ai-signals/symbol-specs";
import { buildAST } from "./ast";
import { buildEntryExpression } from "./entries";
import { buildMQL5Source, mql5FileName, MQL5BuildContext } from "./mql5";
import { compileMQL5 } from "./compile";
import { buildParityReport } from "./parity";
import { generateMagicNumber, generateStrategyHash } from "./metadata";
import { isEAReady, validateStrategyForEA } from "./validator";
import { EAGenerateOptions, EAGenerationResult, EAStrategySnapshot, ValidationIssue } from "./types";

export const EA_GENERATOR_VERSION = "1.0.0";

export const KNOWN_TIMEFRAMES = new Set(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"]);

/**
 * Collects every timeframe the compiled EA must maintain feature state for:
 * the setup timeframe always, plus every explicit rule timeframe.
 */
export function collectUsedTimeframes(strategy: Strategy): string[] {
    const tfs = new Set<string>();
    if (strategy.timeframes?.setup) tfs.add(strategy.timeframes.setup);
    for (const rule of [...(strategy.entryRules ?? []), ...(strategy.confirmationRules ?? [])]) {
        if (!rule.enabled) continue;
        const tf = rule.timeframe ?? strategy.timeframes?.setup;
        if (tf) tfs.add(tf);
    }
    return [...tfs].sort();
}

export function buildEAStrategySpec(strategy: Strategy): EAStrategySnapshot {
    return {
        strategyId: strategy.id,
        name: strategy.name,
        version: strategy.version,
        symbol: strategy.asset,
        timeframe: strategy.timeframes.setup,
        direction: strategy.direction,
        risk: {
            mode: strategy.risk.mode,
            riskPercent: strategy.risk.riskPercent,
            fixedLot: strategy.risk.fixedLot,
            maxPositions: strategy.risk.maxPositions,
            dailyLossLimitPct: strategy.risk.dailyLossLimitPct,
            maxDrawdownPct: strategy.risk.maxDrawdownPct,
        },
        stopLoss: strategy.stopLoss,
        takeProfit: strategy.takeProfit,
        filters: {
            sessions: strategy.filters.sessions,
            daysOfWeek: strategy.filters.daysOfWeek,
            volatilityMinAtrPct: strategy.filters.volatilityMinAtrPct,
            volatilityMaxAtrPct: strategy.filters.volatilityMaxAtrPct,
            maxTradesPerDay: strategy.filters.maxTradesPerDay,
            cooldownCandles: strategy.filters.cooldownCandles,
        },
        executionModel: strategy.executionModel,
        costs: strategy.costs,
        regimeFilter: strategy.regimeFilter ?? [],
        maxSpreadPoints: maxSpreadPointsFor(strategy),
    };
}

/** Converts the strategy's modeled spread (pips) into broker points. */
export function maxSpreadPointsFor(strategy: Strategy): number {
    if (!strategy.costs || strategy.costs.spreadPips <= 0) return 0;
    const spec = getSymbolSpec(strategy.asset);
    if (!spec) return 0;
    const point = Math.pow(10, -spec.digits);
    const points = Math.round((strategy.costs.spreadPips * spec.pipSize) / point);
    // Keep the EA near the model; a hard 0 disables the filter entirely.
    return points > 0 ? points : 0;
}

function eaVersionFor(options: EAGenerateOptions): string {
    return options.generatorVersion ?? EA_GENERATOR_VERSION;
}

/**
 * Generates the complete MQL5 Expert Advisor source for a validated strategy.
 * Does NOT persist anything — callers own storage.
 */
export async function generateEAForStrategy(
    strategy: Strategy,
    options: EAGenerateOptions = {}
): Promise<EAGenerationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const validation = validateStrategyForEA(strategy);
    errors.push(...validation.filter((v) => v.severity === "error"));
    warnings.push(...validation.filter((v) => v.severity === "warning"));

    if (!isEAReady(errors)) {
        return {
            success: false,
            errors,
            warnings,
            compiled: false,
            hash: strategy ? generateStrategyHash(strategy) : undefined,
        };
    }

    const ast = buildAST(strategy, {
        enableGateway: options.enableGateway ?? true,
        enableLicense: options.enableLicense ?? false,
        licenseDurationDays: options.licenseDurationDays ?? 1,
        sourceAvailable: options.sourceAvailable ?? true,
        protected: options.protected ?? false,
        generatorVersion: eaVersionFor(options),
        strategyHash: generateStrategyHash(strategy),
    });
    const usedTimeframes = collectUsedTimeframes(strategy);
    const unknownTfs = usedTimeframes.filter((tf) => !KNOWN_TIMEFRAMES.has(tf));
    if (unknownTfs.length > 0) {
        errors.push({
            severity: "error",
            field: "timeframes",
            message: `Unsupported timeframe(s) for MT5 EA: ${unknownTfs.join(", ")}. Supported: ${[...KNOWN_TIMEFRAMES].join(", ")}.`,
        });
        return { success: false, errors, warnings, compiled: false, hash: generateStrategyHash(strategy) };
    }

    const tfToEnum: Record<string, string> = {
        M1: "PERIOD_M1",
        M3: "PERIOD_M3",
        M5: "PERIOD_M5",
        M15: "PERIOD_M15",
        M30: "PERIOD_M30",
        H1: "PERIOD_H1",
        H4: "PERIOD_H4",
        D1: "PERIOD_D1",
    };

    const tfVar = (c: { timeframe?: string }): string => {
        const tf = c.timeframe ?? strategy.timeframes.setup;
        return `f_${tf}`;
    };

    const entry = buildEntryExpression(ast.entry.conditions, tfVar);
    const confirmation = buildEntryExpression(ast.entry.confirmationConditions, tfVar);

    if (!entry) {
        errors.push({ severity: "error", field: "entryRules", message: "Entry rules could not be translated to MQL5." });
        return { success: false, errors, warnings, compiled: false, hash: generateStrategyHash(strategy) };
    }

    const partiallyTranslated = (entry.code.includes("false /* untranslatable rule */")) ||
        !!confirmation && confirmation.code.includes("false /* untranslatable rule */");
    if (partiallyTranslated) {
        warnings.push({
            severity: "warning",
            field: "entryRules",
            message: "One or more entry/confirmation rules were untranslatable and compiled as a hard-false condition. Review the rules before deploying this EA.",
        });
    }

    const spec = buildEAStrategySpec(strategy);
    const setupTf = strategy.timeframes.setup;
    const configHash = generateStrategyHash(strategy);
    const magicNumber = generateMagicNumber(strategy.id, strategy.asset, strategy.version);
    const eaVersion = eaVersionFor(options);

    const partials = Object.fromEntries(
        (strategy.takeProfit?.partialCloses ?? []).map((p) => [p.atR, p.closePercent])
    );

    const ctx: MQL5BuildContext = {
        eaName: strategy.name,
        eaVersion,
        strategyName: strategy.name,
        strategyId: strategy.id,
        strategyVersion: strategy.version,
        strategyHash: configHash,
        generatorVersion: EA_GENERATOR_VERSION,
        magicNumber,
        symbol: strategy.asset,
        comment: `AlgoVault ${strategy.asset}`,
        setupTf,
        usedTimeframes,
        tfToEnum,
        direction: strategy.direction,
        entryExpression: entry.code,
        confirmationExpression: confirmation && confirmation.code !== "true" ? confirmation.code : null,
        useRegime: (strategy.regimeFilter ?? []).length > 0,
        regimes: strategy.regimeFilter ?? [],
        sessions: strategy.filters.sessions ?? [],
        weekdaysBitmask: weekdaysBitmaskFor(strategy.filters.daysOfWeek ?? []),
        volMinAtrPct: strategy.filters.volatilityMinAtrPct ?? 0,
        volMaxAtrPct: strategy.filters.volatilityMaxAtrPct ?? 0,
        maxTradesPerDay: strategy.filters.maxTradesPerDay ?? 0,
        cooldownCandles: strategy.filters.cooldownCandles ?? 0,
        maxSpreadPoints: spec.maxSpreadPoints,
        riskMode: strategy.risk.mode,
        riskPercent: strategy.risk.riskPercent,
        fixedLot: strategy.risk.fixedLot,
        maxPositions: strategy.risk.maxPositions,
        dailyLossLimitPct: strategy.risk.dailyLossLimitPct,
        maxDrawdownPct: strategy.risk.maxDrawdownPct,
        maxSlippagePoints: Math.max(1, Math.round((strategy.costs?.slippagePips ?? 0.5) * 10)),
        slMode: strategy.stopLoss.mode,
        slAtrMultiple: strategy.stopLoss.atrMultiple,
        slLevelOffset: strategy.stopLoss.levelOffset,
        tpMode: strategy.takeProfit.mode,
        tpR1: strategy.takeProfit.r1,
        tpR2: strategy.takeProfit.r2,
        tpR3: strategy.takeProfit.r3,
        tpFixedDistance: strategy.takeProfit.fixedDistance,
        tpPartialR1Pct: partials[1] ?? 0,
        tpPartialR2Pct: partials[2] ?? 0,
        moveBeAfterTp1: strategy.takeProfit.moveBeAfterTp1,
        lockAfterTp2: strategy.takeProfit.lockAfterTp2,
        trailingEnabled: strategy.takeProfit.trailingEnabled,
        trailingStopAtr: strategy.takeProfit.trailingStopAtr,
    };

    const code = buildMQL5Source(ctx);

    const fileName = mql5FileName(strategy.name, strategy.asset, eaVersion);
    let compileReport: EAGenerationResult["compileErrors"] = [];
    let compileWarnings: EAGenerationResult["compileWarnings"] = [];
    let compiled = false;
    let compilerOutput: string | undefined;
    let compileMethod: "metaeditor" | "static" | undefined;

    if (options.compile !== false) {
        const cr = await compileMQL5(code, fileName, { timeoutMs: 150_000 });
        compiled = cr.success;
        compileReport = cr.errors;
        compileWarnings = cr.warnings;
        compilerOutput = cr.compilerOutput;
        compileMethod = cr.method;
        if (cr.notes && cr.notes.length > 0) {
            warnings.push({ severity: "warning", field: "compile", message: cr.notes.join(" ") });
        }
        if (!cr.success) {
            errors.push({
                severity: "error",
                field: "compile",
                message: `MQL5 compilation failed (${cr.method}): ${cr.errors.slice(0, 5).join(" | ") || "unknown error"}`,
            });
        }
    }

    const parity = buildParityReport({
        strategy,
        symbolSpec: getSymbolSpec(strategy.asset),
        magicNumber,
        hasConfirmationRules: (strategy.confirmationRules ?? []).some((r) => r.enabled),
        usedTimeframes,
        entryExpressionDebug: entry.code,
    });

    return {
        success: errors.filter((e) => e.severity === "error").length === 0,
        spec,
        errors,
        warnings,
        code,
        compiled,
        compilerOutput,
        compileErrors: compileReport,
        compileWarnings,
        hash: configHash,
        parity,
        meta: {
            strategyId: strategy.id,
            strategyVersion: strategy.version,
            symbol: strategy.asset,
            timeframe: setupTf,
            magicNumber,
            generatorVersion: EA_GENERATOR_VERSION,
            eaVersion,
            configurationHash: configHash,
            executionModel: strategy.executionModel,
            usedTimeframes,
            fileName,
            fileVersion: 1,
            compileMethod,
            compiledAt: compiled ? Date.now() : undefined,
        },
    };
}

/** day 0=Sunday .. 6=Saturday → bit 1<<day. Empty list = every day (255). */
export function weekdaysBitmaskFor(days: number[]): number {
    if (!days || days.length === 0) return 255;
    let mask = 0;
    for (const d of days) {
        if (d >= 0 && d <= 6) mask |= 1 << d;
    }
    return mask === 0 ? 255 : mask;
}

/** 16-hex config hash over the EA-relevant strategy snapshot. */
export function configurationHashFor(strategy: Strategy): string {
    return generateStrategyHash(strategy);
}