// ─────────────────────────────────────────────────────────────────────────────
// EA Generator tests — determinism, semantic translation, untranslatable-rule
// detection, no-hardcoding guards, and (env-gated) real MetaEditor compilation.
//
// Run: npm run test:ea
//      ALGOVAULT_RUN_COMPILER=1 npm run test:ea   (real MetaEditor compile)
// ─────────────────────────────────────────────────────────────────────────────

import { Strategy } from "../../types";
import {
    generateEAForStrategy,
    collectUsedTimeframes,
    configurationHashFor,
    weekdaysBitmaskFor,
} from "../generator";
import { staticValidateMQL5 } from "../compile";
import { buildEntryExpression } from "../entries";
import { buildAST } from "../ast";

function makeWhyp() {
    return {
        discovered: "",
        conditionsSelected: "",
        occurrenceFrequency: "",
        historicalPerformance: "",
        weaknesses: "",
        poorRegimes: "",
        generatedByProvider: "test",
    };
}

export function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
    const base: Strategy = {
        id: "strat_test_1",
        name: "Test Gold Momentum",
        description: "Test strategy",
        asset: "XAUUSD",
        direction: "long",
        timeframes: { macro: "H4", structure: "H1", setup: "M15", entry: "M5" },
        regimeFilter: ["trending_bullish", "breakout"],
        entryRules: [
            { id: "r1", enabled: true, group: "trend", label: "EMA structure bullish", operator: "eq", timeframe: "H4", value: "bullish", groupLogic: "AND" },
            { id: "r2", enabled: true, group: "confirmation", label: "Positive momentum", operator: "eq", timeframe: "M15", value: "momentum_positive", groupLogic: "AND" },
            { id: "r3", enabled: true, group: "structure", label: "Bullish BOS", operator: "eq", timeframe: "M15", value: "bos_bullish", groupLogic: "AND" },
            { id: "r4", enabled: true, group: "fvg", label: "Bullish FVG", operator: "eq", timeframe: "M15", value: "bullish", groupLogic: "AND" },
            { id: "r5", enabled: true, group: "liquidity", label: "Buy-side liquidity", operator: "eq", timeframe: "M15", value: "buy_side", groupLogic: "AND" },
        ],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: {
            mode: "r",
            r1: 1,
            r2: 2,
            r3: 3,
            fixedDistance: 0,
            partialCloses: [
                { atR: 1, closePercent: 33 },
                { atR: 2, closePercent: 33 },
            ],
            moveBeAfterTp1: true,
            lockAfterTp2: true,
            trailingEnabled: true,
            trailingStopAtr: 1.5,
        },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 3, maxDrawdownPct: 20 },
        filters: {
            sessions: ["london", "new_york"],
            daysOfWeek: [1, 2, 3, 4, 5],
            volatilityMinAtrPct: 0,
            volatilityMaxAtrPct: 0,
            maxTradesPerDay: 2,
            cooldownCandles: 3,
        },
        executionModel: "next_bar_open",
        costs: { spreadPips: 2.0, commissionPerLot: 4, slippagePips: 1 },
        sourcePatternId: null,
        whyp: makeWhyp(),
        version: "1.0.0",
        created: 1,
        updated: 1,
    };
    return { ...base, ...overrides };
}

export async function runGeneratorTests(): Promise<boolean> {
    console.log("--- EA Generator Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const strategy = makeStrategy();

    // Test 1: generation succeeds with all feature groups translated.
    console.log("\n[Test 1] Full multi-timeframe strategy generation");
    const result = await generateEAForStrategy(strategy, { compile: false });
    check(result.success === true, `generation success (errors=${result.errors.map((e) => e.message).join("; ") || "none"})`);
    check(!!result.code, "source code produced");
    check(result.errors.filter((e) => e.severity === "error").length === 0, "no validation errors");

    if (result.code) {
        const code = result.code;

        // Test 2: structure of the generated EA.
        console.log("\n[Test 2] Generated EA structure");
        const structureChecks: Array<[string, boolean]> = [
            ["OnInit", code.includes("int OnInit()")],
            ["OnTick", code.includes("void OnTick()")],
            ["feature engine", code.includes("void LoadFeatureState(")],
            ["magic number input", code.includes(`input ulong  MagicNumber        = ${result.meta?.magicNumber};`)],
            ["setup timeframe input", code.includes("input ENUM_TIMEFRAMES SetupTimeframe")],
            ["trade object", /CTrade\s+trade\s*;/.test(code)],
            ["closed-bar entry guard", code.includes("g_lastSetupBarTime")],
            ["risk sizing", code.includes("SYMBOL_VOLUME_MIN")],
            ["stop level guard", code.includes("SYMBOL_TRADE_STOPS_LEVEL")],
            ["multi-timeframe feature vars", code.includes("FeatureState f_H4;")],
            ["per-TF feature load", code.includes("LoadFeatureState(f_H4, PERIOD_H4);")],
            ["f_setup alias", code.includes("#define f_setup f_M15")],
            ["regime engine", code.includes("DetectRegime")],
            ["session filter", code.includes('StrIn(f_setup.session, "london,new_york")')],
            ["partial close", code.includes("PartialClosePctR1")],
            ["break-even", code.includes("MoveBEEnabled")],
            ["trailing input on", code.includes("input bool   EnableTrailing     = true;")],
        ];
        for (const [label, ok] of structureChecks) {
            check(ok, `contains ${label}`);
        }

        // Test 3: no hardcoded prices / lots / fake identifiers.
        console.log("\n[Test 3] No hardcoded prices/lots and no fake MQL5");
        const fakeIdentifiers = ["StringArrayContains", "ArrayContains", "if(price > 1000)", "0.01 /* fixed lot */"];
        for (const fake of fakeIdentifiers) {
            check(!code.includes(fake), `no '${fake}'`);
        }
        // Entries must be price-generic: no literal entry price in code.
        check(!/PositionOpen\(\s*\d/.test(code), "no numeric literal in PositionOpen");
        check(!code.includes("MissingIdent"), "no undeclared identifiers");

        // Test 4: static syntax validation pass.
        console.log("\n[Test 4] Static MQL5 syntax validation");
        const s = staticValidateMQL5(code);
        check(s.errors.length === 0, `zero static errors (${s.errors.join(" | ")})`);
        check(code.includes("#property strict"), "has #property strict");

        // Test 5: determinism — hash, magic, and code identical across runs.
        console.log("\n[Test 5] Determinism");
        const again = await generateEAForStrategy(strategy, { compile: false });
        check(configurationHashFor(strategy) === configurationHashFor(strategy), "config hash stable");
        check(result.hash === again.hash, "hash identical across runs");
        check(result.meta?.magicNumber === again.meta?.magicNumber, "magic identical across runs");
        check(result.code === again.code, "source identical across runs");
        const magic = result.meta?.magicNumber ?? 0;
        check(magic >= 100000 && magic <= 999999, `magic in safe range (${magic})`);
        check(typeof magic === "number" && Number.isInteger(magic), "magic is an integer");
    }

    // Test 6: untranslatable rules are reported, never silently altered.
    console.log("\n[Test 6] Untranslatable rule detection");
    const customRule = makeStrategy({
        entryRules: [
            { id: "c1", enabled: true, group: "custom" as never, label: "Custom magic", operator: "eq", value: "whatever", timeframe: "M5", groupLogic: "AND" } as never,
        ],
    });
    const untranslatable = await generateEAForStrategy(customRule, { compile: false });
    check(untranslatable.warnings.some((w) => w.message.includes("untranslatable")), "warning emitted for untranslatable rule");
    check(!!untranslatable.code && untranslatable.code.includes("false /* untranslatable rule */"), "compiled as honest hard-false");

    // Test 7: unsupported timeframe rejected loudly.
    console.log("\n[Test 7] Unsupported timeframe rejection");
    const badTf = makeStrategy({ timeframes: { macro: "H4", structure: "H1", setup: "W1" as never, entry: "M5" } });
    const badTfResult = await generateEAForStrategy(badTf, { compile: false });
    check(badTfResult.success === false, "generation rejected");
    check(badTfResult.errors.some((e) => e.field === "timeframes"), "timeframe error reported");

    // Test 8: trailing disabled ⇒ broker TP3 set; trailing enabled ⇒ not.
    console.log("\n[Test 8] Trailing / TP mode semantics");
    const trailingOff = makeStrategy({ takeProfit: { ...makeStrategy().takeProfit, trailingEnabled: false } });
    const trailingOn = makeStrategy();
    const offCode = (await generateEAForStrategy(trailingOff, { compile: false })).code ?? "";
    const onCode = (await generateEAForStrategy(trailingOn, { compile: false })).code ?? "";
    check(offCode.includes("input bool   EnableTrailing     = false;"), "trailing off → input false");
    check(onCode.includes("input bool   EnableTrailing     = true;"), "trailing on → input true");

    // Test 9: helpers.
    console.log("\n[Test 9] Helper functions");
    check(collectUsedTimeframes(strategy).includes("H4") && collectUsedTimeframes(strategy).includes("M15"), "usedTimeframes includes rule + setup TFs");
    check(collectUsedTimeframes(strategy).includes("M15"), "setup always included");
    check(weekdaysBitmaskFor([0, 1, 2, 3, 4, 5, 6]) === 127, "weekday bitmask all days");
    check(weekdaysBitmaskFor([1, 2, 3, 4, 5]) === 62, "weekday bitmask weekdays");
    check(weekdaysBitmaskFor([]) === 255, "weekday bitmask empty → 255 (every day)");

    // Test 10: multi-timeframe rule expression references per-TF structs.
    console.log("\n[Test 10] Rule translation references per-timeframe features");
    const ast = buildAST(strategy, {
        enableGateway: true,
        enableLicense: false,
        licenseDurationDays: 1,
        sourceAvailable: true,
        protected: false,
        generatorVersion: "test",
        strategyHash: "testhash",
    });
    const expr = buildEntryExpression(ast.entry.conditions, (c) => `f_${c.timeframe ?? strategy.timeframes.setup}`)!;
    check(expr.code.includes("f_H4.trend"), "trend rule on H4 feature state");
    check(expr.code.includes("f_M15.bosDirection"), "structure rule on M15 feature state");
    check(expr.code.includes("f_M15.momentumPct"), "confirmation rule on M15 feature state");

    // Test 11 (env-gated): real MetaEditor compilation must produce 0 errors.
    console.log("\n[Test 11] Real MetaEditor compile (env-gated)");
    if (process.env.ALGOVAULT_RUN_COMPILER === "1") {
        const { compileMQL5, detectMetaEditor } = await import("../compile");
        const info = detectMetaEditor();
        if (!info.available) {
            console.error("  SKIP: MetaEditor not available in this environment — cannot verify real compile.");
        } else {
            const cr = await compileMQL5(result.code ?? "", `AlgoVault_Test_EA_v1_0_0.mq5`, { timeoutMs: 90_000 });
            check(cr.method === "metaeditor", `used real compiler (${cr.method})`);
            check(cr.success === true, `compiled with 0 errors (${cr.errors.join("; ") || "no errors"} | ${cr.warnings.length} warning(s))`);
            if (!cr.success) {
                console.error("  compiler output:", cr.compilerOutput);
                console.error("  compile errors:", cr.errors.slice(0, 10));
            }
        }
    } else {
        console.log("  SKIP: set ALGOVAULT_RUN_COMPILER=1 to verify against real MetaEditor (uses wine locally).");
    }

    console.log("");
    return passed;
}